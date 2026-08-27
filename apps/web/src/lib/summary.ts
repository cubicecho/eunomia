import type { AppSummaryRow, CategoryDaySummary } from '@/api';
import { categoryColor } from '@/lib/palette';

// Reshaping the server's two aggregate queries into what each chart plots.
// The server returns categorySummary pre-aggregated per (day, category) and
// appSummary per (app, context); everything here is grouping and sorting.

export const UNCATEGORIZED = 'Uncategorized';
/** Series key for the no-category bucket — real keys are category UUIDs. */
export const UNCATEGORIZED_KEY = 'uncategorized';

export interface Series {
  /** Category id, or null for the uncategorized bucket. */
  id: string | null;
  /** Chart series key: the category id, or UNCATEGORIZED_KEY. */
  key: string;
  name: string;
  color: string;
  seconds: number;
}

/** Totals per category over the whole range, largest first. */
export function categoryTotals(summary: CategoryDaySummary[]): Series[] {
  const byCategory = new Map<string, Series>();
  for (const row of summary) {
    const key = row.categoryId ?? UNCATEGORIZED_KEY;
    const entry = byCategory.get(key) ?? {
      id: row.categoryId,
      key,
      name: row.name ?? UNCATEGORIZED,
      color: categoryColor(row.categoryId, row.color),
      seconds: 0,
    };
    entry.seconds += row.seconds;
    byCategory.set(key, entry);
  }
  return [...byCategory.values()].sort((a, b) => b.seconds - a.seconds);
}

export interface DayRow {
  day: string;
  total: number;
  /** Seconds per category key — the stacked series for that day. */
  [key: string]: string | number;
}

/**
 * One row per day in the range, ascending, with a column per category. Days
 * with no activity are included as zeros so the axis doesn't lie about gaps.
 */
export function dayRows(summary: CategoryDaySummary[], series: Series[]): DayRow[] {
  const byDay = new Map<string, DayRow>();
  for (const row of summary) {
    const day = byDay.get(row.day) ?? { day: row.day, total: 0 };
    const key = row.categoryId ?? UNCATEGORIZED_KEY;
    day[key] = ((day[key] as number | undefined) ?? 0) + row.seconds;
    day.total += row.seconds;
    byDay.set(row.day, day);
  }
  return [...byDay.values()]
    .map((day) => {
      for (const s of series) if (day[s.key] === undefined) day[s.key] = 0;
      return day;
    })
    .sort((a, b) => a.day.localeCompare(b.day));
}

export interface ContextTotal {
  name: string;
  seconds: number;
  /** True for the remainder row, which is not a rank in the context ramp. */
  remainder: boolean;
}

export interface AppTotal {
  name: string;
  seconds: number;
  /** Sub-app breakdown (browser site, open project/book), largest first. */
  contexts: ContextTotal[];
}

export const MAX_CONTEXTS_PER_APP = 6;

export function topApps(rows: AppSummaryRow[], count = 10): AppTotal[] {
  const byApp = new Map<string, { seconds: number; contexts: Map<string, number> }>();
  for (const row of rows) {
    const entry = byApp.get(row.app) ?? { seconds: 0, contexts: new Map<string, number>() };
    entry.seconds += row.seconds;
    if (row.context) {
      entry.contexts.set(row.context, (entry.contexts.get(row.context) ?? 0) + row.seconds);
    }
    byApp.set(row.app, entry);
  }
  return [...byApp.entries()]
    .map(([name, entry]) => {
      const contexts: ContextTotal[] = [...entry.contexts.entries()]
        .map(([context, seconds]) => ({ name: context, seconds, remainder: false }))
        .sort((a, b) => b.seconds - a.seconds)
        .slice(0, MAX_CONTEXTS_PER_APP);
      // Contextless time (plus any contexts beyond the cap) in an app that has
      // contexts shows up as a remainder row so the sub-bars sum to the app bar.
      const accounted = contexts.reduce((sum, c) => sum + c.seconds, 0);
      const leftover = entry.seconds - accounted;
      if (contexts.length > 0 && leftover >= 1) {
        contexts.push({ name: '(other)', seconds: leftover, remainder: true });
      }
      return { name, seconds: entry.seconds, contexts };
    })
    .sort((a, b) => b.seconds - a.seconds)
    .slice(0, count);
}

export const sumSeconds = (rows: { seconds: number }[]): number =>
  rows.reduce((total, row) => total + row.seconds, 0);

export interface EntryGroup {
  app: string;
  seconds: number;
  /** Contexts recorded under the app, largest first. */
  contexts: { context: string; seconds: number }[];
  /** Time in the app under no context at all. */
  contextless: number;
}

/**
 * Every (app, context) pair the user has recorded, grouped by app, largest
 * first — the merge view's inventory of names.
 *
 * Unlike topApps this caps nothing and rolls nothing into an "(other)": the
 * entry someone came here to fix is exactly the one too small to make a top
 * ten, and a bucket you can't name is one you can't merge.
 */
export function allEntries(rows: AppSummaryRow[]): EntryGroup[] {
  const byApp = new Map<
    string,
    { seconds: number; contextless: number; contexts: Map<string, number> }
  >();
  for (const row of rows) {
    const entry = byApp.get(row.app) ?? {
      seconds: 0,
      contextless: 0,
      contexts: new Map<string, number>(),
    };
    entry.seconds += row.seconds;
    if (row.context) {
      entry.contexts.set(row.context, (entry.contexts.get(row.context) ?? 0) + row.seconds);
    } else {
      entry.contextless += row.seconds;
    }
    byApp.set(row.app, entry);
  }
  return [...byApp.entries()]
    .map(([app, entry]) => ({
      app,
      seconds: entry.seconds,
      contextless: entry.contextless,
      contexts: [...entry.contexts.entries()]
        .map(([context, seconds]) => ({ context, seconds }))
        .sort((a, b) => b.seconds - a.seconds),
    }))
    .sort((a, b) => b.seconds - a.seconds);
}
