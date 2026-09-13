import { and, asc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  ACCRUE_CAP_SECONDS,
  CLOSE_AFTER_SECONDS,
  IDLE_THRESHOLD_SECONDS,
} from '../activity/fold.ts';
import { ownerZone } from '../activity/rollup.ts';
import { devices, pings, user } from '../db/schema.ts';
import type { ExportWriter } from './chunk.ts';

// The raw ping log as ActivityWatch's own export: the document aw-server's
// `GET /api/0/export` produces and `POST /api/0/import` (the web UI's Import
// button) accepts —
//
//   {"buckets": {"<id>": {id, created, type, client, hostname, data, events}}}
//
// with two buckets per device, shaped exactly like the watchers ActivityWatch
// ships: `aw-watcher-window_<host>` (type currentwindow, events carry
// {app, title}) and `aw-watcher-afk_<host>` (type afkstatus, {status}). Matching
// those names is what makes the imported data show up in ActivityWatch's
// Activity view rather than as an unknown bucket; the host is the device name.
//
// Built from pings, not activities: activities are eunomia's model (per-app
// accrual, rule-derived contexts, categories), while ActivityWatch keeps
// intervals of raw window state and computes everything else at query time.
// Context isn't carried — aw-watcher-window has no such field, and ActivityWatch
// derives its own from its own rules.
//
// Pings are samples ~10 s apart; ActivityWatch events are intervals. A ping
// credits the time since the one before it, capped at ACCRUE_CAP_SECONDS —
// the same span the fold credits (fold.ts) — so a silence longer than that
// leaves a hole rather than stretching an event over a sleeping machine.

/** An interval of one state, epoch milliseconds. */
export interface Span {
  start: number;
  end: number;
  data: Record<string, string>;
}

/** What a converter carries from one ping to the next, across chunks too. */
export interface ConverterState {
  prevAt: number | null;
  /** The interval still being extended, not yet written. */
  pending: Span | null;
}

export type Pass = 'window' | 'afk';

export interface PingSample {
  at: number;
  app: string | null;
  title: string | null;
  idleSeconds: number;
}

const CAP_MS = ACCRUE_CAP_SECONDS * 1000;
const CLOSE_MS = CLOSE_AFTER_SECONDS * 1000;

const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), high);

export const initialConverter = (): ConverterState => ({ prevAt: null, pending: null });

/**
 * Feeds one ping (in fold order) to a pass's converter, returning the spans it
 * completed. Mutates `state`.
 */
export function pushPing(pass: Pass, state: ConverterState, ping: PingSample): Span[] {
  const done: Span[] = [];
  const { prevAt, pending } = state;
  // Whether the previous ping's span runs straight into this one's.
  const contiguous = prevAt !== null && ping.at - prevAt <= CAP_MS;
  // Where this ping's credited time starts. After a silence long enough to
  // close every activity the fold credits nothing at all (fold.ts), so neither
  // does the event — which is also what lets an import of this file fold back
  // into the same seconds (import/activitywatch.ts).
  const leadIn =
    prevAt === null || ping.at - prevAt > CLOSE_MS ? ping.at : Math.max(prevAt, ping.at - CAP_MS);
  state.prevAt = ping.at;

  if (pass === 'window') {
    // A ping with no app is a locked screen or a phone with nothing in front:
    // no window, so no window event.
    if (ping.app === null) {
      if (pending) done.push(pending);
      state.pending = null;
      return done;
    }
    const data = { app: ping.app, title: ping.title ?? '' };
    if (
      pending &&
      contiguous &&
      pending.data.app === data.app &&
      pending.data.title === data.title
    ) {
      pending.end = ping.at;
    } else {
      if (pending) done.push(pending);
      state.pending = { start: leadIn, end: ping.at, data };
    }
    return done;
  }

  const status = ping.idleSeconds >= IDLE_THRESHOLD_SECONDS ? 'afk' : 'not-afk';
  // The last input, by the OS's own count: where away really began, or where
  // the user came back.
  const inputAt = ping.at - ping.idleSeconds * 1000;
  if (pending && contiguous && pending.data.status !== status) {
    // Going away ends the active interval at the last input, not at the ping
    // that crossed the threshold — the same walk-back the fold makes.
    // Coming back ends the away interval where input resumed.
    const turn =
      status === 'afk'
        ? clamp(inputAt, pending.start, pending.end)
        : clamp(inputAt, pending.end, ping.at);
    pending.end = turn;
    done.push(pending);
    state.pending = { start: turn, end: ping.at, data: { status } };
  } else if (pending && contiguous) {
    pending.end = ping.at;
  } else {
    if (pending) done.push(pending);
    state.pending = { start: leadIn, end: ping.at, data: { status } };
  }
  return done;
}

/** Ends the converter's input: whatever interval was open is complete. */
export function finishPings(state: ConverterState): Span[] {
  const done = state.pending ? [state.pending] : [];
  state.pending = null;
  return done;
}

/** An ActivityWatch event. Durations are seconds, as aw-server stores them. */
export const toEvent = (span: Span) => ({
  timestamp: new Date(span.start).toISOString(),
  duration: (span.end - span.start) / 1000,
  data: span.data,
});

/**
 * A hostname per device, unique within the export: ActivityWatch keys buckets
 * by `<watcher>_<hostname>`, so two devices both called "laptop" would collide
 * and the second import would fail. Assigned in id order, so every chunk of
 * one export agrees on them.
 */
export function hostnames(list: { id: string; name: string }[]): Map<string, string> {
  const used = new Set<string>();
  const hosts = new Map<string, string>();
  for (const device of list) {
    const base =
      device.name
        .trim()
        .replace(/[^A-Za-z0-9._-]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'device';
    let host = base;
    for (let n = 2; used.has(host); n++) host = `${base}-${n}`;
    used.add(host);
    hosts.set(device.id, host);
  }
  return hosts;
}

const BUCKETS: Record<Pass, { watcher: string; type: string }> = {
  window: { watcher: 'aw-watcher-window', type: 'currentwindow' },
  afk: { watcher: 'aw-watcher-afk', type: 'afkstatus' },
};

const spanSchema = z.object({
  start: z.number(),
  end: z.number(),
  data: z.record(z.string(), z.string()),
});

const awState = z.object({
  /** The device being written, or the last one finished (null before the first). */
  device: z.string().nullable(),
  /** 'next' = that device is finished (or was skipped); move past it. */
  pass: z.enum(['window', 'afk', 'next']),
  /** Whether the pass's bucket is open — its header written, its events array not closed. */
  open: z.boolean(),
  /** The last ping read: capturedAt as Postgres text, and seq. */
  after: z.tuple([z.string(), z.string()]).nullable(),
  converter: z.object({ prevAt: z.number().nullable(), pending: spanSchema.nullable() }),
  /** Events written into the open bucket, and buckets written — where commas go. */
  events: z.number().int().min(0),
  buckets: z.number().int().min(0),
});

type AwState = z.infer<typeof awState>;

export const activityWatchChunk: ExportWriter<AwState> = {
  state: awState,
  ranged: true,
  async write(db, { userId, from, to, state: resumed, pageSize }) {
    let out = '';
    let rows = 0;
    const state: AwState = resumed ?? {
      device: null,
      pass: 'next',
      open: false,
      after: null,
      converter: initialConverter(),
      events: 0,
      buckets: 0,
    };
    if (!resumed) out += '{"buckets":{';

    // The range's days as instants where the owner's days start, resolved in
    // SQL like every other day boundary (rollup.ts).
    const [bounds] = await db
      .select({
        from: from
          ? sql<string>`((${from}::date)::timestamp at time zone ${ownerZone})::text`
          : sql<null>`null`,
        to: to
          ? sql<string>`((${to}::date)::timestamp at time zone ${ownerZone})::text`
          : sql<null>`null`,
      })
      .from(user)
      .where(eq(user.id, userId));
    const inRange = [
      bounds?.from ? sql`${pings.capturedAt} >= ${bounds.from}::timestamptz` : undefined,
      bounds?.to ? sql`${pings.capturedAt} < ${bounds.to}::timestamptz` : undefined,
    ];

    // Re-read every chunk rather than trusted from the cursor: this is the
    // fence. A device id in the state that isn't the caller's is simply not
    // in this list, and is treated like one deleted mid-export.
    const owned = await db
      .select({ id: devices.id, name: devices.name, createdAt: devices.createdAt })
      .from(devices)
      .where(eq(devices.userId, userId))
      .orderBy(asc(devices.id));
    const hosts = hostnames(owned);

    const writeSpans = (spans: Span[]) => {
      for (const span of spans) {
        out += `${state.events > 0 ? ',' : ''}\n${JSON.stringify(toEvent(span))}`;
        state.events += 1;
      }
    };
    const closeBucket = (pass: Pass) => {
      writeSpans(finishPings(state.converter));
      out += '\n]}';
      state.buckets += 1;
      state.open = false;
      state.after = null;
      state.converter = initialConverter();
      state.pass = pass === 'window' ? 'afk' : 'next';
    };

    while (rows < pageSize) {
      if (state.pass === 'next') {
        const current = state.device;
        const next = owned.find((device) => current === null || device.id > current);
        if (!next) {
          out += '\n}}\n';
          return { data: out, rows, state: null };
        }
        state.device = next.id;
        // A device with nothing in range gets no buckets rather than empty ones.
        const [any] = await db
          .select({ one: sql`1` })
          .from(pings)
          .where(and(eq(pings.deviceId, next.id), ...inRange))
          .limit(1);
        if (any) state.pass = 'window';
        continue;
      }

      const pass = state.pass;
      const device = owned.find(({ id }) => id === state.device);
      if (!device) {
        // Deleted since the last chunk (or never the caller's): end its bucket
        // with what was already written and go on to the next.
        if (state.open) closeBucket('afk');
        state.pass = 'next';
        continue;
      }

      if (!state.open) {
        const host = hosts.get(device.id)!;
        const id = `${BUCKETS[pass].watcher}_${host}`;
        const head = JSON.stringify({
          id,
          created: device.createdAt.toISOString(),
          type: BUCKETS[pass].type,
          client: BUCKETS[pass].watcher,
          hostname: host,
          data: {},
        });
        out += `${state.buckets > 0 ? ',' : ''}\n${JSON.stringify(id)}:${head.slice(0, -1)},"events":[`;
        state.open = true;
        state.events = 0;
      }

      const limit = pageSize - rows;
      const after = state.after;
      const page = await db
        .select({
          capturedAt: pings.capturedAt,
          app: pings.app,
          title: pings.title,
          idleSeconds: pings.idleSeconds,
          key: sql<string[]>`array[${pings.capturedAt}::text, ${pings.seq}::text]`,
        })
        .from(pings)
        .where(
          and(
            eq(pings.deviceId, device.id),
            ...inRange,
            after
              ? sql`(${pings.capturedAt}, ${pings.seq}) > (${after[0]}::timestamptz, ${after[1]}::bigint)`
              : undefined,
          ),
        )
        .orderBy(asc(pings.capturedAt), asc(pings.seq))
        .limit(limit);
      for (const ping of page) {
        writeSpans(
          pushPing(pass, state.converter, {
            at: ping.capturedAt.getTime(),
            app: ping.app,
            title: ping.title,
            idleSeconds: ping.idleSeconds,
          }),
        );
      }
      rows += page.length;
      if (page.length < limit) closeBucket(pass);
      else state.after = page.at(-1)!.key as [string, string];
    }
    return { data: out, rows, state };
  },
};
