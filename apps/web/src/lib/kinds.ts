import type { CategoryDaySummary, CategoryKind } from '@/api';
import { UNCATEGORIZED_COLOR } from '@/lib/palette';
import { UNCATEGORIZED, UNCATEGORIZED_KEY } from '@/lib/summary';

// Category kinds: what sort of time a category holds, one level above the
// categories themselves. A user's twelve categories are theirs to name; the
// five kinds are fixed, so "how much of my week was focus" means the same
// thing on every account.

export interface KindInfo {
  value: CategoryKind;
  label: string;
  /** One line for the picker, saying what belongs there. */
  hint: string;
  color: string;
}

/**
 * In the order the dashboard lists them: from the time worth protecting to the
 * time worth trimming, with neutral in the middle.
 *
 * Colors are a diverging scale by meaning, not the category palette's identity
 * slots — green for the focus end, red for the distracting end — and are never
 * the only carrier: every kind is labelled wherever its color appears.
 */
export const KINDS: readonly KindInfo[] = [
  { value: 'focus', label: 'Focus', hint: 'deep work: code, writing, design', color: '#008300' },
  { value: 'work', label: 'Work', hint: 'meetings, email, admin', color: '#199e70' },
  { value: 'neutral', label: 'Neutral', hint: 'neither here nor there', color: '#3987e5' },
  { value: 'personal', label: 'Personal', hint: 'time for yourself', color: '#9085e9' },
  {
    value: 'distracting',
    label: 'Distracting',
    hint: 'time you would rather spend less of',
    color: '#e66767',
  },
];

export const DEFAULT_KIND: CategoryKind = 'neutral';

export const kindInfo = (kind: CategoryKind): KindInfo =>
  KINDS.find((info) => info.value === kind) ?? (KINDS[2] as KindInfo);

export interface KindTotal {
  /** The kind, or UNCATEGORIZED_KEY for time in no category. */
  key: CategoryKind | typeof UNCATEGORIZED_KEY;
  label: string;
  color: string;
  seconds: number;
}

/**
 * Seconds per kind over the rows, in KINDS order, with uncategorized time as a
 * bucket of its own at the end — it has no kind, and folding it into neutral
 * would make "neutral" mean "haven't looked yet". Kinds with no time are left
 * out.
 */
export function kindTotals(summary: CategoryDaySummary[]): KindTotal[] {
  const seconds = new Map<string, number>();
  for (const row of summary) {
    const key = row.categoryId === null ? UNCATEGORIZED_KEY : (row.kind ?? DEFAULT_KIND);
    seconds.set(key, (seconds.get(key) ?? 0) + row.seconds);
  }
  const totals: KindTotal[] = KINDS.map((info) => ({
    key: info.value,
    label: info.label,
    color: info.color,
    seconds: seconds.get(info.value) ?? 0,
  }));
  totals.push({
    key: UNCATEGORIZED_KEY,
    label: UNCATEGORIZED,
    color: UNCATEGORIZED_COLOR,
    seconds: seconds.get(UNCATEGORIZED_KEY) ?? 0,
  });
  return totals.filter((total) => total.seconds >= 1);
}
