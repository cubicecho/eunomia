import { z } from 'zod';
import { extractContext } from '../activity/context.ts';
import { loadFoldRules } from '../activity/ingest.ts';
import { mergeEntry } from '../activity/merge-rules.ts';
import { addSeconds } from '../activity/rollup.ts';
import { matchRule } from '../activity/rules.ts';
import { devices } from '../db/schema.ts';
import { badInput } from '../errors.ts';
import { requireOwned } from '../graphql/guards.ts';
import { isCalendarDay } from '../graphql/summaries.ts';
import { EARLIEST_IMPORT, field, type Importer } from './importer.ts';

// RescueTime history in, as daily summaries rather than pings.
//
// What RescueTime lets a user take out is its Analytic Data API report (and the
// CSV its data-export page produces from the same query): rows of
//
//   Date, Time Spent (seconds), Number of People, Activity, Document, Category, Productivity
//
// at best per five-minute interval (perspective=interval, resolution_time=
// minute), more often per hour or per day. That is time per app per bucket
// with no order inside the bucket — nothing says whether ten minutes of an
// editor came before or after five of a browser, or in one stretch or ten.
// Synthesizing pings from it would invent an order, focus segments and
// activity boundaries that were never observed, and the fold would faithfully
// turn that invention into history. So the rows go straight into summaries —
// the table that already means "this many seconds of this app on this day" —
// on the device the user picks, categorized by the user's own rules
// (RescueTime's categories are its own taxonomy, not the user's).
//
// Consequences worth knowing, and said in the dashboard too:
//
// - The Date is local time with no zone, and is read as a day in the caller's
//   zone. A later time zone change doesn't move these days: summaries have no
//   instants to re-bucket (see rebucketSummaries).
// - Importing the same export twice counts it twice; there is no identity to
//   de-duplicate rows by.
// - Category rules applied later (applyCategoryRules) don't reach them, like
//   any rolled summary whose activities are gone.
//
// Records are CSV records — the client splits the file, minding quoted line
// breaks — and the first is the header. Columns are found by name, so the
// API's CSV, its JSON rows re-joined by the client, and the older export's
// spelling (Timestamp, Seconds) all read the same.

const COLUMNS = {
  date: ['date', 'timestamp', 'time', 'datetime', 'day'],
  seconds: ['time spent (seconds)', 'seconds', 'duration', 'time spent'],
  minutes: ['time spent (minutes)', 'minutes'],
  activity: ['activity', 'application', 'app', 'name'],
  document: ['document', 'details', 'title'],
} as const;

const columnsSchema = z.object({
  date: z.number().int().min(0),
  activity: z.number().int().min(0),
  /** Seconds or minutes, whichever the file has; `scale` turns it into seconds. */
  amount: z.number().int().min(0),
  scale: z.union([z.literal(1), z.literal(60)]),
  document: z.number().int().min(0).nullable(),
});

const importState = z.object({
  deviceId: z.string(),
  /** Null until the header has been read. */
  columns: columnsSchema.nullable(),
});

type RescueTimeState = z.infer<typeof importState>;

/** One row's seconds — a row is at most a day. */
const MAX_ROW_SECONDS = 86_400;

/**
 * Splits one CSV record into fields: comma separated, double-quoted where a
 * field holds a comma, quote or line break, with "" for a quote inside quotes.
 */
export function csvFields(record: string): string[] {
  const fields: string[] = [];
  let current = '';
  let quoted = false;
  for (let i = 0; i < record.length; i++) {
    const char = record[i]!;
    if (quoted) {
      if (char === '"' && record[i + 1] === '"') {
        current += '"';
        i++;
      } else if (char === '"') {
        quoted = false;
      } else {
        current += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      fields.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  fields.push(current.replace(/\r$/, ''));
  return fields;
}

/** Where each column is, by header name; null when the header isn't RescueTime's. */
export function readHeader(record: string): z.infer<typeof columnsSchema> | null {
  // A spreadsheet's saved CSV often starts with a byte-order mark.
  const names = csvFields(record.replace(/^\uFEFF/, '')).map((name) => name.trim().toLowerCase());
  const find = (aliases: readonly string[]) => {
    const index = names.findIndex((name) => aliases.includes(name));
    return index === -1 ? null : index;
  };
  const date = find(COLUMNS.date);
  const activity = find(COLUMNS.activity);
  const seconds = find(COLUMNS.seconds);
  const minutes = find(COLUMNS.minutes);
  if (date === null || activity === null || (seconds === null && minutes === null)) return null;
  return {
    date,
    activity,
    amount: seconds ?? minutes!,
    scale: seconds === null ? 60 : 1,
    document: find(COLUMNS.document),
  };
}

export const rescueTimeImporter: Importer<RescueTimeState> = {
  state: importState,
  targeted: true,
  begin: (_db, _userId, device) => ({ deviceId: device!.id, columns: null }),
  async apply(db, { userId, state, records, done, tally }) {
    const device = await requireOwned(db, devices, state.deviceId, userId, 'Unknown device');
    let rest = records;
    if (state.columns === null) {
      const columns = rest.length ? readHeader(rest[0]!) : null;
      if (!columns) {
        throw badInput(
          'Not a RescueTime export: the first line must name its Date, Time Spent and Activity columns',
        );
      }
      state.columns = columns;
      rest = rest.slice(1);
    }
    const columns = state.columns;

    // Summed per call, then written once per key: a day's hourly rows for one
    // app are one summary row, and one upsert rather than twenty-four.
    const totals = new Map<
      string,
      {
        day: string;
        app: string;
        context: string | null;
        categoryId: string | null;
        seconds: number;
      }
    >();
    const latestDay = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    const earliestDay = new Date(EARLIEST_IMPORT).toISOString().slice(0, 10);
    const rules = rest.length ? await loadFoldRules(db, userId) : null;

    for (const record of rest) {
      if (record.trim() === '') continue;
      const fields = csvFields(record);
      const day = (fields[columns.date] ?? '').trim().slice(0, 10);
      // Number('') is 0, and a blank duration is a broken row, not an empty one.
      const amount = Number((fields[columns.amount] ?? '').trim() || Number.NaN);
      const app = field(fields[columns.activity]);
      const document = columns.document === null ? null : field(fields[columns.document]);
      if (!isCalendarDay(day) || day < earliestDay || day > latestDay) {
        tally.skip('Row with an impossible date');
        continue;
      }
      const seconds = amount * columns.scale;
      if (!Number.isFinite(seconds) || seconds < 0 || seconds > MAX_ROW_SECONDS) {
        tally.skip('Row with an impossible duration');
        continue;
      }
      if (!app) {
        tally.skip('Row without an activity');
        continue;
      }
      tally.accepted += 1;
      if (seconds === 0) continue;

      // The fold's own resolution (resolvePing), minus the fold: context from
      // the document by the user's rules, then merges, then the category.
      const extracted = extractContext(rules!.context, app, document);
      const entry = mergeEntry(rules!.merge, { app, context: extracted });
      const categoryId =
        matchRule(rules!.category, entry.app, document, entry.context)?.categoryId ?? null;
      const key = JSON.stringify([day, entry.app, entry.context, categoryId]);
      const total = totals.get(key);
      if (total) total.seconds += seconds;
      else totals.set(key, { day, ...entry, categoryId, seconds });
    }

    for (const { seconds, ...key } of totals.values()) {
      await addSeconds(db, { deviceId: device.id, ...key }, seconds);
    }
    return { state: done ? null : state, deviceIds: [device.id] };
  },
};
