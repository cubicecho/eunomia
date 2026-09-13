import { describe, expect, it } from 'vitest';
import type { CategoryDaySummary, CategoryKind } from '@/api';
import { kindTotals } from '@/lib/kinds';
import { UNCATEGORIZED_COLOR } from '@/lib/palette';
import { compareWeeks, delta, weeksSpan, weekWindows } from '@/lib/trends';

const WORK = { id: 'work', name: 'Work', color: '#3fb950', kind: 'work' as CategoryKind };
const CODE = { id: 'code', name: 'Code', color: '#3987e5', kind: 'focus' as CategoryKind };
const FUN = { id: 'fun', name: 'Fun', color: '#d55181', kind: 'distracting' as CategoryKind };

const row = (
  day: string,
  seconds: number,
  category: { id: string; name: string; color: string; kind: CategoryKind } | null = null,
): CategoryDaySummary => ({
  day,
  seconds,
  categoryId: category?.id ?? null,
  name: category?.name ?? null,
  color: category?.color ?? null,
  kind: category?.kind ?? null,
});

describe('weekWindows', () => {
  it('compares the elapsed days of this week with the same days of last week', () => {
    // 2026-09-16 is a Wednesday.
    expect(weekWindows('2026-09-16')).toEqual({
      current: { from: '2026-09-14', to: '2026-09-17' },
      previous: { from: '2026-09-07', to: '2026-09-10' },
      days: 3,
    });
  });

  it('runs Monday to Sunday', () => {
    expect(weekWindows('2026-09-14')).toMatchObject({
      current: { from: '2026-09-14', to: '2026-09-15' },
      previous: { from: '2026-09-07', to: '2026-09-08' },
      days: 1,
    });
    // A Sunday closes the week: seven whole days on each side.
    expect(weekWindows('2026-09-20')).toMatchObject({
      current: { from: '2026-09-14', to: '2026-09-21' },
      previous: { from: '2026-09-07', to: '2026-09-14' },
      days: 7,
    });
  });

  it('crosses month and year boundaries as calendar days', () => {
    // Thursday 1 January 2026: the week began in December.
    const windows = weekWindows('2026-01-01');
    expect(windows.current).toEqual({ from: '2025-12-29', to: '2026-01-02' });
    expect(windows.previous).toEqual({ from: '2025-12-22', to: '2025-12-26' });
    expect(weeksSpan(windows)).toEqual({ from: '2025-12-22', to: '2026-01-02' });
  });
});

describe('delta', () => {
  it('is relative to last week, and has no ratio with nothing to be relative to', () => {
    expect(delta(150, 100)).toEqual({ current: 150, previous: 100, change: 50, ratio: 0.5 });
    expect(delta(0, 100).ratio).toBe(-1);
    expect(delta(60, 0)).toEqual({ current: 60, previous: 0, change: 60, ratio: null });
  });
});

describe('compareWeeks', () => {
  const windows = weekWindows('2026-09-16'); // Wednesday

  it('totals each window, ignoring last week past the like-for-like cut', () => {
    const comparison = compareWeeks(
      [
        row('2026-09-07', 3600, WORK),
        row('2026-09-09', 1800, CODE),
        // Last Thursday and Sunday: outside the comparison on a Wednesday.
        row('2026-09-10', 99_999, WORK),
        row('2026-09-13', 99_999, FUN),
        row('2026-09-14', 3600, WORK),
        row('2026-09-16', 3600, CODE),
        row('2026-09-16', 600),
      ],
      windows,
    );
    expect(comparison.total).toEqual(delta(7800, 5400));
  });

  it('pairs categories across the weeks, including ones only one week had', () => {
    const { categories } = compareWeeks(
      [
        row('2026-09-08', 1000, WORK),
        row('2026-09-08', 500, FUN),
        row('2026-09-15', 4000, CODE),
        row('2026-09-15', 1500, WORK),
        row('2026-09-15', 300),
      ],
      windows,
    );
    expect(categories.map(({ key, current, previous }) => ({ key, current, previous }))).toEqual([
      { key: 'code', current: 4000, previous: 0 },
      { key: 'work', current: 1500, previous: 1000 },
      { key: 'uncategorized', current: 300, previous: 0 },
      // Gone this week, still listed: a drop to nothing is the biggest change.
      { key: 'fun', current: 0, previous: 500 },
    ]);
    expect(categories[0]).toMatchObject({ label: 'Code', color: '#3987e5', ratio: null });
    expect(categories[1]).toMatchObject({ change: 500, ratio: 0.5 });
    expect(categories[2]).toMatchObject({ label: 'Uncategorized', color: UNCATEGORIZED_COLOR });
  });

  it('pairs kinds in their fixed order, uncategorized last', () => {
    const { kinds } = compareWeeks(
      [
        row('2026-09-08', 500, FUN),
        row('2026-09-08', 200),
        row('2026-09-15', 1500, WORK),
        row('2026-09-15', 4000, CODE),
      ],
      windows,
    );
    expect(kinds.map(({ key, current, previous }) => [key, current, previous])).toEqual([
      ['focus', 4000, 0],
      ['work', 1500, 0],
      ['distracting', 0, 500],
      ['uncategorized', 0, 200],
    ]);
  });
});

describe('kindTotals', () => {
  it('sums categories by kind, keeping uncategorized time out of neutral', () => {
    expect(
      kindTotals([
        row('2026-09-15', 100, { ...WORK, id: 'meetings', kind: 'work' }),
        row('2026-09-15', 200, WORK),
        row('2026-09-15', 50, { ...FUN, kind: 'neutral' }),
        row('2026-09-15', 70),
      ]).map(({ key, seconds }) => [key, seconds]),
    ).toEqual([
      ['work', 300],
      ['neutral', 50],
      ['uncategorized', 70],
    ]);
  });
});
