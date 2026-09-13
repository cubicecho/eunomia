import { z } from 'zod';
import { ACCRUE_CAP_SECONDS, CLOSE_AFTER_SECONDS } from '../activity/fold.ts';
import { ingestPings, loadFoldRules } from '../activity/ingest.ts';
import type { RawPing } from '../activity/ping-log.ts';
import { devices } from '../db/schema.ts';
import { badInput } from '../errors.ts';
import { requireOwned } from '../graphql/guards.ts';
import { field, type Importer, plausibleInstant, type Tally } from './importer.ts';

// ActivityWatch history in, as pings. ActivityWatch stores intervals of state
// per watcher bucket; eunomia stores the samples an agent would have sent. So
// an import is the export (export/activitywatch.ts) run backwards: work out
// what was in front of the user at each moment, then emit the pings an agent
// watching that screen would have — through ingestPings, like every other
// ping, so rules, merges, contexts, focus segments and rollups all come out
// the way they would have live.
//
// The client sends the buckets it read from aw-server's export as one list of
// events sorted by start, across buckets:
//
//   {"format":"activitywatch","afk":true}                    header, first record
//   {"type":"currentwindow","timestamp":…,"duration":…,"data":{"app","title"}}
//   {"type":"afkstatus","timestamp":…,"duration":…,"data":{"status"}}
//   {"type":"web.tab.current","timestamp":…,"duration":…,"data":{"url",…}}
//
// `afk` says whether an afkstatus bucket is among them. With one, only time the
// AFK watcher marked not-afk counts, as in ActivityWatch's own views; without
// one (a machine that never ran aw-watcher-afk) every window interval does.
//
// At each instant the latest-started window event covering it is the foreground
// app, and when that app is a browser, the latest-started web event covering
// it names the site — its hostname becomes the ping's context, the same thing
// the desktop agent reports. Anything else is left to the user's context rules.
//
// Pings are then placed so the fold credits each interval its own length:
// keep-alives every KEEP_ALIVE_MS while an app stays in front, a closing ping
// where it stops, and — since the fold credits a ping the time since the
// previous one, capped at ACCRUE_CAP_SECONDS — an interval that starts after
// a short silence gets its first ping ACCRUE_CAP_SECONDS in, so that ping's
// capped credit is exactly the time since the interval began. After a silence
// long enough to close every activity the fold credits the first ping nothing,
// so there the first ping goes at the interval's start. That makes a file this
// server exported fold back into the same seconds; real ActivityWatch data,
// whose intervals don't come from pings, is within a few seconds per interval
// shorter than ACCRUE_CAP_SECONDS.
//
// Streaming: events arrive a call at a time, and a call can only convert the
// timeline up to the latest start it has seen, since a later call's events
// start no earlier. What is still open past that point is carried in the
// cursor.

/** The spacing of emitted pings while one app stays in front. Under the accrual cap. */
const KEEP_ALIVE_MS = 25_000;
const CAP_MS = ACCRUE_CAP_SECONDS * 1000;
const CLOSE_MS = CLOSE_AFTER_SECONDS * 1000;

/**
 * Longest event kept. aw-server merges heartbeats into one event for as long as
 * nothing changes, so a machine left on a window over a weekend is one long
 * event; a longer one is a watcher bug rather than a day in front of a screen.
 */
const MAX_EVENT_MS = 24 * 60 * 60_000;

/**
 * Pings one call may emit — about 70 hours in front of a screen. The client
 * sends far less per call; this is the fence against a crafted file making one
 * request fold millions of pings.
 */
export const MAX_IMPORT_PINGS = 10_000;

/** Events still open at the end of a call, carried in the cursor. Normally one per bucket. */
const MAX_CARRIED = 100;

/** Pings per ingestPings call — one device lock and one log append each. */
const INGEST_BATCH = 1000;

/**
 * Apps whose web events describe what's on screen. Only these take a hostname
 * from the web bucket: a browser tab stays "current" in aw-watcher-web while
 * the user is in an editor, and a context on the editor would be wrong.
 */
const BROWSER =
  /chrom(e|ium)|firefox|brave|msedge|microsoft.edge|opera|vivaldi|safari|librewolf|waterfox|floorp|^zen|^arc(\.exe)?$/i;

const eventSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('window'),
    start: z.number(),
    end: z.number(),
    app: z.string(),
    title: z.string().nullable(),
  }),
  z.object({ kind: z.literal('afk'), start: z.number(), end: z.number(), away: z.boolean() }),
  z.object({
    kind: z.literal('web'),
    start: z.number(),
    end: z.number(),
    host: z.string().nullable(),
  }),
]);

/** An ActivityWatch event, normalized: epoch milliseconds and only the data used. */
export type AwEvent = z.infer<typeof eventSchema>;

const emitterSchema = z.object({
  /** The last ping emitted. */
  prevAt: z.number().nullable(),
  /** The app in front, not yet closed: its key, where it has reached, and its next keep-alive. */
  seg: z
    .object({
      app: z.string(),
      title: z.string().nullable(),
      context: z.string().nullable(),
      end: z.number(),
      nextAt: z.number(),
    })
    .nullable(),
});

const converterSchema = z.object({
  /** Whether an AFK bucket is included; null until the header has been read. */
  afk: z.boolean().nullable(),
  /** The timeline is converted up to here; no later event may start before it. */
  swept: z.number().nullable(),
  carried: z.array(eventSchema).max(MAX_CARRIED),
  emitter: emitterSchema,
});

export type Converter = z.infer<typeof converterSchema>;

export const initialConverter = (afk: boolean | null = null): Converter => ({
  afk,
  swept: null,
  carried: [],
  emitter: { prevAt: null, seg: null },
});

interface Key {
  app: string;
  title: string | null;
  context: string | null;
}

/** The latest-started of `events` — the one ActivityWatch would show. */
function latest<E extends AwEvent>(events: E[]): E | undefined {
  let best: E | undefined;
  for (const event of events) if (!best || event.start >= best.start) best = event;
  return best;
}

/** What is in front of the user while exactly `active` events cover the moment. */
function keyAt(active: AwEvent[], afk: boolean): Key | null {
  if (afk) {
    const afkEvents = active.filter((e) => e.kind === 'afk');
    // Present only while the AFK watcher said so — and not while an overlapping
    // event also says away, which a restarted watcher can leave behind.
    if (!afkEvents.some((e) => !e.away) || afkEvents.some((e) => e.away)) return null;
  }
  const window = latest(active.filter((e) => e.kind === 'window'));
  if (!window) return null;
  const web = BROWSER.test(window.app) ? latest(active.filter((e) => e.kind === 'web')) : undefined;
  return { app: window.app, title: window.title, context: web?.host ?? null };
}

/**
 * Advances a converter over `events` (sorted by start, none before
 * `converter.swept`), returning the pings for the timeline they settle.
 * `done` converts everything and closes the last app. Mutates `converter`.
 */
export function convertEvents(converter: Converter, events: AwEvent[], done: boolean): RawPing[] {
  const emitted: RawPing[] = [];
  const emitter = converter.emitter;
  const emit = (at: number, key: Key) => {
    if (emitted.length >= MAX_IMPORT_PINGS) {
      throw badInput('Too much activity in one call; send fewer events at a time');
    }
    emitted.push({
      capturedAt: new Date(at),
      app: key.app,
      title: key.title,
      context: key.context,
      idleSeconds: 0,
    });
    emitter.prevAt = at;
  };
  const close = () => {
    const seg = emitter.seg;
    if (seg && (emitter.prevAt === null || emitter.prevAt < seg.end)) emit(seg.end, seg);
    emitter.seg = null;
  };

  /** One stretch of the timeline with the same thing in front. */
  const feed = (p: number, q: number, key: Key | null) => {
    if (!key) return close();
    const seg = emitter.seg;
    if (seg && seg.end === p && seg.app === key.app && seg.context === key.context) {
      // The same activity carrying on; a new title churns in place, as live.
      seg.title = key.title;
    } else {
      const contiguous = seg?.end === p;
      close();
      let first: number;
      if (contiguous) {
        // Straight on from another app: that one's closing ping is at `p`, so
        // the first keep-alive credits this one from `p`.
        first = p + KEEP_ALIVE_MS;
      } else if (emitter.prevAt === null || p + CAP_MS - emitter.prevAt > CLOSE_MS) {
        // Nothing open to accrue from: this ping opens the activity at 0.
        emit(p, key);
        first = p + KEEP_ALIVE_MS;
      } else {
        // After a short silence: the capped credit of a ping CAP_MS in is the
        // time since `p` (or a little more, for an interval shorter than that).
        const at = Math.min(p + CAP_MS, q);
        emit(at, key);
        first = at + KEEP_ALIVE_MS;
      }
      emitter.seg = { ...key, end: p, nextAt: first };
    }
    const current = emitter.seg!;
    for (; current.nextAt < q; current.nextAt += KEEP_ALIVE_MS) emit(current.nextAt, current);
    current.end = q;
  };

  const all = [...converter.carried, ...events].sort((a, b) => a.start - b.start);
  if (all.length === 0) {
    if (done) close();
    return emitted;
  }
  const from = converter.swept ?? all[0]!.start;
  // Without `done`, only up to the latest start: an event in the next call
  // may begin there and change what is in front from then on.
  const to = done
    ? Math.max(from, ...all.map((e) => e.end))
    : Math.max(from, ...all.map((e) => e.start));

  const bounds = [
    ...new Set(
      [from, to, ...all.flatMap((e) => [e.start, e.end])].filter((t) => t >= from && t <= to),
    ),
  ].sort((a, b) => a - b);
  let next = 0;
  let active: AwEvent[] = [];
  for (let i = 0; i + 1 < bounds.length; i++) {
    const p = bounds[i]!;
    const q = bounds[i + 1]!;
    while (next < all.length && all[next]!.start <= p) active.push(all[next++]!);
    active = active.filter((e) => e.end > p);
    feed(p, q, keyAt(active, converter.afk ?? false));
  }

  converter.swept = to;
  if (done) {
    close();
    converter.carried = [];
  } else {
    // Keep the events that reach past the swept point, latest first if a
    // crafted file overlaps more of them than a cursor should hold.
    converter.carried = all
      .filter((e) => e.end > to)
      .sort((a, b) => b.start - a.start)
      .slice(0, MAX_CARRIED);
  }
  return emitted;
}

/** The hostname of an http(s) URL — what the desktop agent reports as a browser's context. */
function hostOf(url: unknown): string | null {
  if (typeof url !== 'string') return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
      ? field(parsed.hostname)
      : null;
  } catch {
    return null;
  }
}

const recordSchema = z.object({
  type: z.string(),
  timestamp: z.string(),
  duration: z.number(),
  data: z.record(z.string(), z.unknown()),
});

/** One record as an event, or the reason it can't be one. */
export function parseEvent(record: string): AwEvent | string {
  let parsed: z.infer<typeof recordSchema>;
  try {
    parsed = recordSchema.parse(JSON.parse(record));
  } catch {
    return 'Unreadable event';
  }
  const start = Date.parse(parsed.timestamp);
  if (!plausibleInstant(start)) return 'Event with an impossible timestamp';
  if (!Number.isFinite(parsed.duration) || parsed.duration < 0) {
    return 'Event with an impossible duration';
  }
  const end = start + Math.min(Math.round(parsed.duration * 1000), MAX_EVENT_MS);
  const { data } = parsed;
  switch (parsed.type) {
    case 'currentwindow': {
      const app = field(data.app);
      if (!app) return 'Window event without an app';
      return { kind: 'window', start, end, app, title: field(data.title) };
    }
    case 'afkstatus':
      if (data.status !== 'afk' && data.status !== 'not-afk') return 'AFK event without a status';
      return { kind: 'afk', start, end, away: data.status === 'afk' };
    case 'web.tab.current':
      return { kind: 'web', start, end, host: hostOf(data.url) };
    default:
      return `Unsupported bucket type: ${parsed.type.slice(0, 40)}`;
  }
}

const headerSchema = z.object({ format: z.literal('activitywatch'), afk: z.boolean() });

const importState = z.object({ deviceId: z.string(), converter: converterSchema });

type AwImportState = z.infer<typeof importState>;

export const activityWatchImporter: Importer<AwImportState> = {
  state: importState,
  targeted: true,
  begin: (_db, _userId, device) => ({ deviceId: device!.id, converter: initialConverter() }),
  async apply(db, { userId, state, records, done, tally }) {
    // The cursor names the device; it has to be the caller's every time.
    const device = await requireOwned(db, devices, state.deviceId, userId, 'Unknown device');
    const converter = state.converter;
    let rest = records;
    if (converter.afk === null) {
      const header = rest.length ? headerOf(rest[0]!) : null;
      if (!header) {
        throw badInput('Not an ActivityWatch import: the first record must be its header');
      }
      converter.afk = header.afk;
      rest = rest.slice(1);
    }

    const events = parseEvents(rest, converter.swept, tally);
    let pings = convertEvents(converter, events, done);
    // Before a device's pingLogFrom the log is incomplete, so ingestion would
    // log these and never fold them (ingest.ts) — history that silently counts
    // for nothing. Dropped instead, and said: a new device takes all of it.
    const logFrom = device.pingLogFrom?.getTime();
    if (logFrom !== undefined) {
      const kept = pings.filter((ping) => ping.capturedAt.getTime() >= logFrom);
      if (kept.length < pings.length) {
        tally.warn(
          `Pings from before ${device.pingLogFrom!.toISOString().slice(0, 10)}, where this device's history was pruned, were left out; import into a new device to keep them`,
          pings.length - kept.length,
        );
      }
      pings = kept;
    }
    if (pings.length) {
      const rules = await loadFoldRules(db, userId);
      for (let i = 0; i < pings.length; i += INGEST_BATCH) {
        await ingestPings(db, device, pings.slice(i, i + INGEST_BATCH), rules);
      }
      tally.pings += pings.length;
    }
    return { state: done ? null : state, deviceIds: [device.id] };
  },
};

function headerOf(record: string): z.infer<typeof headerSchema> | null {
  try {
    return headerSchema.parse(JSON.parse(record));
  } catch {
    return null;
  }
}

/** A call's records as events in start order, skipping (and counting) the unusable. */
function parseEvents(records: readonly string[], swept: number | null, tally: Tally): AwEvent[] {
  const events: AwEvent[] = [];
  for (const record of records) {
    const event = parseEvent(record);
    if (typeof event === 'string') {
      tally.skip(event);
    } else if (swept !== null && event.start < swept) {
      // That stretch was already converted and ingested; it can't change now.
      tally.skip('Event earlier than ones already imported (events must be sent in time order)');
    } else if (event.end > event.start) {
      events.push(event);
      tally.accepted += 1;
    } else {
      // aw-server leaves zero-length events behind heartbeats; they cover nothing.
      tally.accepted += 1;
    }
  }
  return events.sort((a, b) => a.start - b.start);
}
