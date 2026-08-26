/** Durations, dates, and the range the dashboard asks the server for. */

export function formatSeconds(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  if (h === 0) return `${m}m`;
  // "5h 0m" is a rounding artifact pretending to be precision.
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/** Hours as a number, for chart axes and tooltips that do their own units. */
export const toHours = (seconds: number): number => seconds / 3600;

/** "just now" / "5m ago" / "3h ago" / "2d ago" from an elapsed duration. */
export function ago(elapsedMs: number): string {
  const minutes = Math.floor(elapsedMs / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/** 'YYYY-MM-DD' in the browser's zone (toISOString would shift the day). */
export function localDay(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** 'YYYY-MM-DD' → 'Mon 25', for axis ticks. Parsed as a local date, not UTC. */
export function shortDay(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  if (!y || !m || !d) return day;
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
  });
}

export interface DateRange {
  from: string;
  to: string;
}

/**
 * Ranges are half-open [from, to) whole days. Local calendar days, not UTC
 * ones — the server reads these as whole days in ITS zone, so asking for UTC's
 * "today" cut the evening off for anyone west of Greenwich.
 */
export function rangeOfLastDays(days: number): DateRange {
  const to = new Date();
  to.setHours(24, 0, 0, 0); // next local midnight — exclusive, so today counts
  const from = new Date(to);
  from.setDate(from.getDate() - days);
  return { from: localDay(from), to: localDay(to) };
}

/** 'YYYY-MM-DD' shifted by whole local days. */
export function addDays(day: string, delta: number): string {
  const date = new Date(`${day}T00:00:00`);
  if (Number.isNaN(date.getTime())) return day;
  date.setDate(date.getDate() + delta);
  return localDay(date);
}

/** Whole days covered by a [from, to) range; at least 1. */
export function daysInRange(range: DateRange): number {
  const from = new Date(`${range.from}T00:00:00`).getTime();
  const to = new Date(`${range.to}T00:00:00`).getTime();
  if (Number.isNaN(from) || Number.isNaN(to)) return 1;
  return Math.max(1, Math.round((to - from) / 86_400_000));
}
