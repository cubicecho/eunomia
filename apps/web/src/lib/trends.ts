import type { CategoryDaySummary } from '@/api';
import { addDays, type DateRange } from '@/lib/format';
import { KINDS, kindTotals } from '@/lib/kinds';
import { categoryTotals } from '@/lib/summary';

// Week over week: this week so far against the same stretch of last week.
//
// Weeks are calendar weeks in the user's time zone, Monday to Sunday (ISO
// 8601), built from the days `categorySummary` already returns — no table of
// its own, nothing precomputed.
//
// A week in progress is compared like for like. On a Wednesday, this week is
// Monday–Wednesday, and it is set against LAST Monday–Wednesday, not against
// all seven days of last week, which would make every week look like a
// collapse until Sunday. The unit is whole days, because that is what the
// summaries are bucketed by: today, still under way, is compared with the
// whole of last week's same weekday, so the current figure runs a little
// behind until the day is over.

/** The two windows a comparison reads, each half-open [from, to) like DateRange. */
export interface WeekWindows {
  current: DateRange;
  previous: DateRange;
  /** Days of the current week elapsed, today included: 1 on a Monday, 7 on a Sunday. */
  days: number;
}

/** 0 for Monday … 6 for Sunday, for a 'YYYY-MM-DD' read as a date in no zone. */
const weekdayOf = (day: string): number => (new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7;

/** The windows for the week containing `today` (a calendar day in the user's zone). */
export function weekWindows(today: string): WeekWindows {
  const days = weekdayOf(today) + 1;
  const monday = addDays(today, 1 - days);
  const lastMonday = addDays(monday, -7);
  return {
    current: { from: monday, to: addDays(monday, days) },
    previous: { from: lastMonday, to: addDays(lastMonday, days) },
    days,
  };
}

/** Everything both windows need, as one query's range. */
export const weeksSpan = (windows: WeekWindows): DateRange => ({
  from: windows.previous.from,
  to: windows.current.to,
});

export interface Delta {
  current: number;
  previous: number;
  /** current − previous, in seconds. */
  change: number;
  /** change / previous; null when there was nothing last week to be relative to. */
  ratio: number | null;
}

export interface DeltaRow extends Delta {
  key: string;
  label: string;
  color: string;
}

export interface WeekComparison {
  windows: WeekWindows;
  total: Delta;
  /** In KINDS order (uncategorized last), every kind either week had time in. */
  kinds: DeltaRow[];
  /** Largest this week first, then by last week; every category either week had. */
  categories: DeltaRow[];
}

export function delta(current: number, previous: number): Delta {
  return {
    current,
    previous,
    change: current - previous,
    ratio: previous > 0 ? (current - previous) / previous : null,
  };
}

const within = (day: string, range: DateRange) => day >= range.from && day < range.to;

/** Pairs this week's and last week's totals up by key, unordered. */
function pair<T extends { key: string; seconds: number }>(
  current: T[],
  previous: T[],
  label: (item: T) => { label: string; color: string },
): DeltaRow[] {
  const rows = new Map<string, DeltaRow>();
  for (const [list, side] of [
    [current, 'current'],
    [previous, 'previous'],
  ] as const) {
    for (const item of list) {
      // Current wins the label: a category renamed since last week shows
      // under the name it has now.
      const row = rows.get(item.key) ?? { key: item.key, ...label(item), ...delta(0, 0) };
      row[side] = item.seconds;
      rows.set(item.key, row);
    }
  }
  return [...rows.values()].map((row) => ({ ...row, ...delta(row.current, row.previous) }));
}

/**
 * Compares the current week so far with the same days of last week, from
 * summary rows covering at least `weeksSpan(windows)`. Rows outside both
 * windows — the tail of last week past the like-for-like cut — are ignored.
 */
export function compareWeeks(summary: CategoryDaySummary[], windows: WeekWindows): WeekComparison {
  const current = summary.filter((row) => within(row.day, windows.current));
  const previous = summary.filter((row) => within(row.day, windows.previous));
  const sum = (rows: CategoryDaySummary[]) => rows.reduce((total, row) => total + row.seconds, 0);

  // In KINDS order, uncategorized last — whichever week a kind turned up in.
  const rank = (key: string) => {
    const index = KINDS.findIndex((kind) => kind.value === key);
    return index === -1 ? KINDS.length : index;
  };
  const kinds = pair(kindTotals(current), kindTotals(previous), (kind) => ({
    label: kind.label,
    color: kind.color,
  })).sort((a, b) => rank(a.key) - rank(b.key));

  const categories = pair(categoryTotals(current), categoryTotals(previous), (series) => ({
    label: series.name,
    color: series.color,
  })).sort((a, b) => b.current - a.current || b.previous - a.previous);

  return { windows, total: delta(sum(current), sum(previous)), kinds, categories };
}
