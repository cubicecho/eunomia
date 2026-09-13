import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { dayOf, ownerJoin } from '../activity/rollup.ts';
import type { Db } from '../db/client.ts';
import { activities, categories, devices, summaries, user } from '../db/schema.ts';
import {
  isCalendarDay,
  liveDayBounds,
  mergeSummaries,
  summaryDayBounds,
} from '../graphql/summaries.ts';
import type { ExportWriter } from './chunk.ts';

// Daily totals as a spreadsheet: one row per day, device, category, app and
// context, with the seconds the dashboard would show for them. The same two
// halves every summary query stitches together (graphql/summaries.ts) — rolled
// rows plus the live aggregation the rollup hasn't claimed yet — so the file
// agrees with the charts, today included.
//
// Names rather than ids, since the reader is a person with a spreadsheet: a
// deleted category's time reads as uncategorized, exactly as on the dashboard.

export const CSV_HEADER = ['day', 'device', 'category', 'app', 'context', 'seconds'];

/** Days per query. A month of daily rows is small; the whole history at once need not be. */
const WINDOW_DAYS = 31;

/**
 * Windows per call at most, however few rows they held — so a sparse history
 * (or a cursor claiming a range of millennia) still returns promptly.
 */
const MAX_WINDOWS = 12;

const addDays = (day: string, delta: number): string => {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + delta);
  return date.toISOString().slice(0, 10);
};

/**
 * One CSV field (RFC 4180), with formula injection defused. App names, titles
 * and contexts come from whatever was on screen, and a spreadsheet runs a cell
 * that starts with `=`, `+`, `-` or `@` as a formula — a page titled
 * `=HYPERLINK(…)` shouldn't become one. The leading apostrophe is the
 * convention spreadsheets themselves use for "this is text".
 */
export function csvField(value: string | null): string {
  if (value === null) return '';
  const text = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

const csvLine = (fields: string[]): string => `${fields.join(',')}\r\n`;

interface Row {
  day: string;
  deviceId: string;
  device: string;
  categoryId: string | null;
  category: string | null;
  app: string;
  context: string | null;
  seconds: number;
}

/** Every row with a day in [from, to), sorted the way a reader scans them. */
async function windowRows(db: Db, userId: string, from: string, to: string): Promise<Row[]> {
  const start = sql`${from}::date`;
  const end = sql`${to}::date`;
  const [rolled, live] = await Promise.all([
    db
      .select({
        day: summaries.day,
        deviceId: summaries.deviceId,
        device: devices.name,
        categoryId: summaries.categoryId,
        category: categories.name,
        app: summaries.app,
        context: summaries.context,
        seconds: sql<number>`sum(${summaries.seconds})::float`,
      })
      .from(summaries)
      .innerJoin(devices, eq(summaries.deviceId, devices.id))
      .innerJoin(user, ownerJoin.user)
      .leftJoin(categories, eq(summaries.categoryId, categories.id))
      .where(and(eq(devices.userId, userId), ...summaryDayBounds(start, end)))
      .groupBy(
        summaries.day,
        summaries.deviceId,
        devices.name,
        summaries.categoryId,
        categories.name,
        summaries.app,
        summaries.context,
      ),
    db
      .select({
        day: dayOf,
        deviceId: activities.deviceId,
        device: devices.name,
        categoryId: activities.categoryId,
        category: categories.name,
        app: activities.app,
        context: activities.context,
        seconds: sql<number>`sum(${activities.activeSeconds})::float`,
      })
      .from(activities)
      .innerJoin(devices, ownerJoin.device)
      .innerJoin(user, ownerJoin.user)
      .leftJoin(categories, eq(activities.categoryId, categories.id))
      .where(
        and(
          eq(devices.userId, userId),
          eq(activities.rolledUp, false),
          ...liveDayBounds(start, end),
        ),
      )
      .groupBy(
        dayOf,
        activities.deviceId,
        devices.name,
        activities.categoryId,
        categories.name,
        activities.app,
        activities.context,
      ),
  ]);
  const byText = (a: string | null, b: string | null) => (a ?? '').localeCompare(b ?? '');
  return mergeSummaries(
    [...rolled, ...live],
    (row) =>
      `${row.day}\n${row.deviceId}\n${row.categoryId ?? '\0'}\n${row.app}\n${row.context ?? '\0'}`,
  ).sort(
    (a, b) =>
      a.day.localeCompare(b.day) ||
      a.device.localeCompare(b.device) ||
      a.deviceId.localeCompare(b.deviceId) ||
      // Uncategorized last within a device, as on the dashboard.
      (a.category ?? '￿').localeCompare(b.category ?? '￿') ||
      a.app.localeCompare(b.app) ||
      byText(a.context, b.context),
  );
}

/** The first and last day the user has any time on, or null for none. */
async function dataDays(db: Db, userId: string): Promise<{ first: string; last: string } | null> {
  const [[rolled], [live]] = await Promise.all([
    db
      .select({
        first: sql<string | null>`min(${summaries.day})`,
        last: sql<string | null>`max(${summaries.day})`,
      })
      .from(summaries)
      .innerJoin(devices, eq(summaries.deviceId, devices.id))
      .where(eq(devices.userId, userId)),
    db
      .select({
        first: sql<string | null>`min(${dayOf})`,
        last: sql<string | null>`max(${dayOf})`,
      })
      .from(activities)
      .innerJoin(devices, ownerJoin.device)
      .innerJoin(user, ownerJoin.user)
      .where(and(eq(devices.userId, userId), eq(activities.rolledUp, false))),
  ]);
  const firsts = [rolled?.first, live?.first].filter((day): day is string => !!day).sort();
  const lasts = [rolled?.last, live?.last].filter((day): day is string => !!day).sort();
  if (firsts.length === 0 || lasts.length === 0) return null;
  return { first: firsts[0]!, last: lasts.at(-1)! };
}

const day = z.string().refine(isCalendarDay);

const csvState = z.object({
  /** The next window's first day. */
  day,
  /** Exclusive end — fixed when the export started, so today's new rows don't move it. */
  end: day,
});

type CsvState = z.infer<typeof csvState>;

export const summariesCsvChunk: ExportWriter<CsvState> = {
  state: csvState,
  ranged: true,
  async write(db, { userId, from, to, state: resumed, pageSize }) {
    let out = '';
    let state: CsvState | null = resumed;
    if (!state) {
      out += csvLine(CSV_HEADER);
      // An unbounded side stops where the data does, so "everything" is a
      // handful of windows rather than every month since 1970.
      const days = await dataDays(db, userId);
      if (!days) return { data: out, rows: 0, state: null };
      const first = from && from > days.first ? from : days.first;
      const end = to && to < addDays(days.last, 1) ? to : addDays(days.last, 1);
      state = { day: first, end };
    }

    let rows = 0;
    for (let windows = 0; windows < MAX_WINDOWS && rows < pageSize; windows++) {
      if (state.day >= state.end) return { data: out, rows, state: null };
      const windowEnd = addDays(state.day, WINDOW_DAYS);
      const until: string = windowEnd < state.end ? windowEnd : state.end;
      for (const row of await windowRows(db, userId, state.day, until)) {
        out += csvLine([
          row.day,
          csvField(row.device),
          csvField(row.category),
          csvField(row.app),
          csvField(row.context),
          String(Math.round(row.seconds * 1000) / 1000),
        ]);
        rows += 1;
      }
      state = { day: until, end: state.end };
    }
    return { data: out, rows, state: state.day >= state.end ? null : state };
  },
};
