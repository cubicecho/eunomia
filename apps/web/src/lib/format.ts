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

/** The zone this browser runs in — what the Settings tab offers a user. */
export const browserTimeZone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone;

/**
 * 'YYYY-MM-DD' of an instant in `timeZone` — the calendar day the server puts
 * it on for a user in that zone. Not the browser's: someone looking at their
 * data from another continent still sees their own days.
 */
export function dayIn(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

/** The wall clock in `timeZone` at an instant, as its numeric parts. */
function wallClock(instant: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? '00';
  return {
    year: part('year'),
    month: part('month'),
    day: part('day'),
    hour: part('hour'),
    minute: part('minute'),
  };
}

/**
 * 'YYYY-MM-DDTHH:MM' of an instant in `timeZone` — what a datetime-local input
 * shows, in the user's zone rather than the browser's.
 */
export function localIn(instant: Date, timeZone: string): string {
  const wall = wallClock(instant, timeZone);
  return `${wall.year}-${wall.month}-${wall.day}T${wall.hour}:${wall.minute}`;
}

/**
 * The instant a wall-clock time ('YYYY-MM-DD' or 'YYYY-MM-DDTHH:MM') names in
 * `timeZone` — the inverse of localIn, for a deletion that has to say exactly
 * where it starts. Intl only converts the other way, so it guesses with the
 * zone's offset and corrects once: across a DST change the offset at the
 * answer is not the offset at the guess. A time the change skipped (02:30 on
 * a spring-forward night) lands on the far side of the gap.
 */
export function instantIn(local: string, timeZone: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/.exec(local);
  if (!match) return new Date(Number.NaN);
  const [year, month, day, hour = 0, minute = 0] = match.slice(1).map((part) => Number(part ?? 0));
  const wall = Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1, hour, minute);
  const offsetAt = (at: number): number => {
    const clock = wallClock(new Date(at), timeZone);
    const asUtc = Date.UTC(+clock.year, +clock.month - 1, +clock.day, +clock.hour, +clock.minute);
    return asUtc - Math.floor(at / 60_000) * 60_000;
  };
  const guess = wall - offsetAt(wall);
  return new Date(wall - offsetAt(guess));
}

/**
 * 'YYYY-MM-DD' as a Date at UTC midnight. Everything below is arithmetic on
 * calendar dates, not instants, and UTC is the one zone with no DST shift to
 * land a midnight on the wrong side of.
 */
const utcDate = (day: string): Date =>
  /^\d{4}-\d{2}-\d{2}$/.test(day) ? new Date(`${day}T00:00:00Z`) : new Date(Number.NaN);

/** 'YYYY-MM-DD' → 'Mon 25', for axis ticks. The date as written, in no zone. */
export function shortDay(day: string): string {
  const date = utcDate(day);
  if (Number.isNaN(date.getTime())) return day;
  return date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', timeZone: 'UTC' });
}

export interface DateRange {
  from: string;
  to: string;
}

/**
 * Ranges are half-open [from, to) whole days in the user's time zone (`me`'s
 * effectiveTimeZone). The server reads the dates as days there, so "today" has
 * to be today there — asking for the browser's or UTC's cut the evening off
 * for anyone whose zone was behind it.
 */
export function rangeOfLastDays(days: number, timeZone: string): DateRange {
  const to = addDays(dayIn(new Date(), timeZone), 1); // exclusive, so today counts
  return { from: addDays(to, -days), to };
}

/**
 * Everything ever recorded, as a range.
 *
 * The dashboard plots windows; the merge view is an inventory of names, and
 * the name someone came to fix is usually the one that stopped appearing. The
 * floor is a date no agent's history predates rather than an unbounded query —
 * the server's aggregates take whole days, and there is no "all" to ask for.
 */
export function rangeOfEverything(timeZone: string): DateRange {
  return { from: '2000-01-01', to: addDays(dayIn(new Date(), timeZone), 1) };
}

/** 'YYYY-MM-DD' shifted by whole calendar days. */
export function addDays(day: string, delta: number): string {
  const date = utcDate(day);
  if (Number.isNaN(date.getTime())) return day;
  date.setUTCDate(date.getUTCDate() + delta);
  return date.toISOString().slice(0, 10);
}

/** Whole days covered by a [from, to) range; at least 1. */
export function daysInRange(range: DateRange): number {
  const from = utcDate(range.from).getTime();
  const to = utcDate(range.to).getTime();
  if (Number.isNaN(from) || Number.isNaN(to)) return 1;
  return Math.max(1, Math.round((to - from) / 86_400_000));
}
