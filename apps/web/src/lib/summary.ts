import type { AppSummaryRow, CategoryDaySummary } from '@/api';
import { categoryColor } from '@/lib/palette';

// Reshaping the server's two aggregate queries into what each chart plots.
// The server returns categorySummary pre-aggregated per (day, category) and
// appSummary per (app, context, category); everything here is grouping and
// sorting.

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

/**
 * One category's share of a bar. A bar is a list of these rather than a single
 * color because an app's time genuinely splits: a browser is Work on one site
 * and not on the next, and picking a winner would paint over that.
 */
export interface Segment {
  /** Category id, or null for the uncategorized bucket. */
  id: string | null;
  name: string;
  color: string;
  seconds: number;
}

export interface ContextTotal {
  name: string;
  seconds: number;
  /** Category split of this context's time, largest first. */
  segments: Segment[];
}

export interface AppTotal {
  name: string;
  seconds: number;
  /** Category split of the app's whole time, largest first. */
  segments: Segment[];
  /** Sub-app breakdown (browser site, open project/book), largest first. */
  contexts: ContextTotal[];
}

/** Adds a row's seconds to its category's running segment. */
function addSegment(segments: Map<string, Segment>, row: AppSummaryRow): void {
  const key = row.categoryId ?? UNCATEGORIZED_KEY;
  const segment = segments.get(key) ?? {
    id: row.categoryId,
    name: row.categoryName ?? UNCATEGORIZED,
    color: categoryColor(row.categoryId, row.categoryColor),
    seconds: 0,
  };
  segment.seconds += row.seconds;
  segments.set(key, segment);
}

/** Whole seconds only: a sub-second sliver is a rounding artifact, not a bar. */
const orderSegments = (segments: Iterable<Segment>): Segment[] =>
  [...segments].filter((segment) => segment.seconds >= 1).sort((a, b) => b.seconds - a.seconds);

/**
 * The app's own time minus what its listed contexts account for, per category
 * — so the remainder row is colored like the time inside it rather than
 * collapsed into one neutral block.
 */
function remainingSegments(app: Map<string, Segment>, listed: Map<string, Segment>[]): Segment[] {
  const left = new Map([...app].map(([key, segment]) => [key, { ...segment }]));
  for (const segments of listed) {
    for (const [key, segment] of segments) {
      const entry = left.get(key);
      if (entry) entry.seconds -= segment.seconds;
    }
  }
  return orderSegments(left.values());
}

export const MAX_CONTEXTS_PER_APP = 6;

interface ContextAccumulator {
  seconds: number;
  segments: Map<string, Segment>;
}

export function topApps(rows: AppSummaryRow[], count = 10): AppTotal[] {
  const byApp = new Map<
    string,
    { seconds: number; segments: Map<string, Segment>; contexts: Map<string, ContextAccumulator> }
  >();
  for (const row of rows) {
    const entry = byApp.get(row.app) ?? {
      seconds: 0,
      segments: new Map<string, Segment>(),
      contexts: new Map<string, ContextAccumulator>(),
    };
    entry.seconds += row.seconds;
    addSegment(entry.segments, row);
    if (row.context) {
      const context = entry.contexts.get(row.context) ?? {
        seconds: 0,
        segments: new Map<string, Segment>(),
      };
      context.seconds += row.seconds;
      addSegment(context.segments, row);
      entry.contexts.set(row.context, context);
    }
    byApp.set(row.app, entry);
  }
  return [...byApp.entries()]
    .map(([name, entry]) => {
      const kept = [...entry.contexts.entries()]
        .sort(([, a], [, b]) => b.seconds - a.seconds)
        .slice(0, MAX_CONTEXTS_PER_APP);
      const contexts: ContextTotal[] = kept.map(([context, accumulated]) => ({
        name: context,
        seconds: accumulated.seconds,
        segments: orderSegments(accumulated.segments.values()),
      }));
      // Contextless time (plus any contexts beyond the cap) in an app that has
      // contexts shows up as a remainder row so the sub-bars sum to the app bar.
      const leftover = remainingSegments(
        entry.segments,
        kept.map(([, accumulated]) => accumulated.segments),
      );
      const leftoverSeconds = leftover.reduce((sum, segment) => sum + segment.seconds, 0);
      if (contexts.length > 0 && leftoverSeconds >= 1) {
        contexts.push({
          name: '(other)',
          seconds: leftoverSeconds,
          segments: leftover,
        });
      }
      return {
        name,
        seconds: entry.seconds,
        segments: orderSegments(entry.segments.values()),
        contexts,
      };
    })
    .sort((a, b) => b.seconds - a.seconds)
    .slice(0, count);
}

/**
 * Every category present across the given apps, largest first — the legend a
 * bar list needs before its colors stand for anything on their own.
 */
export function appCategories(apps: AppTotal[]): Segment[] {
  const totals = new Map<string, Segment>();
  for (const app of apps) {
    for (const segment of app.segments) {
      const key = segment.id ?? UNCATEGORIZED_KEY;
      const entry = totals.get(key) ?? { ...segment, seconds: 0 };
      entry.seconds += segment.seconds;
      totals.set(key, entry);
    }
  }
  return [...totals.values()].sort((a, b) => b.seconds - a.seconds);
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
