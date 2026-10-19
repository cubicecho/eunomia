import { addDays, instantIn } from '@/lib/format';
import { escapeRegex } from '@/lib/pattern';

// The day timeline's arithmetic, kept out of the component so it can be
// tested: where a day starts in the user's zone, what a drag over the lanes
// selected, and what that selection holds. Everything is milliseconds since
// the epoch, so the view never does date math on Date objects.

/** One focus segment, flattened from the API: when something was in front, and what. */
export interface TimelineSegment {
  id: string;
  deviceId: string;
  activityId: string;
  start: number;
  end: number;
  app: string;
  context: string | null;
  title: string | null;
  categoryId: string | null;
  categoryName: string | null;
  color: string | null;
}

/** [start, end) of a calendar day in `timeZone`. Not always 24h: DST days are 23 or 25. */
export function dayBounds(day: string, timeZone: string): { start: number; end: number } {
  return {
    start: instantIn(day, timeZone).getTime(),
    end: instantIn(addDays(day, 1), timeZone).getTime(),
  };
}

/** Milliseconds of `[start, end)` inside `[from, to)`. */
export const overlap = (start: number, end: number, from: number, to: number): number =>
  Math.max(0, Math.min(end, to) - Math.max(start, from));

/** The segments that show inside the window, cut to it. Zero-length focuses are kept as points. */
export function clip(segments: TimelineSegment[], from: number, to: number): TimelineSegment[] {
  return segments
    .filter((s) => s.end >= from && s.start < to && (s.end > from || s.start === s.end))
    .map((s) => ({ ...s, start: Math.max(s.start, from), end: Math.min(s.end, to) }));
}

/** Segments grouped by device, each lane in time order. */
export function lanes(segments: TimelineSegment[]): Map<string, TimelineSegment[]> {
  const byDevice = new Map<string, TimelineSegment[]>();
  for (const segment of segments) {
    const lane = byDevice.get(segment.deviceId) ?? [];
    lane.push(segment);
    byDevice.set(segment.deviceId, lane);
  }
  for (const lane of byDevice.values()) lane.sort((a, b) => a.start - b.start);
  return byDevice;
}

/** What a drag selected: a stretch of time, on one device or (null) all of them. */
export interface Selection {
  deviceId: string | null;
  from: number;
  to: number;
}

/** The segments a selection covers. */
export function inSelection(segments: TimelineSegment[], selection: Selection): TimelineSegment[] {
  return segments.filter(
    (s) =>
      (selection.deviceId === null || s.deviceId === selection.deviceId) &&
      overlap(s.start, s.end, selection.from, selection.to) > 0,
  );
}

/** One app/context's share of a selection. */
export interface SelectionEntry {
  app: string;
  context: string | null;
  categoryId: string | null;
  categoryName: string | null;
  color: string | null;
  /** Seconds of it inside the selection, not of its whole activity. */
  seconds: number;
  activityIds: string[];
}

/** A selection as entries, largest first: the "what was this?" list beside the actions. */
export function summarize(segments: TimelineSegment[], selection: Selection): SelectionEntry[] {
  const entries = new Map<string, SelectionEntry & { ids: Set<string> }>();
  for (const s of inSelection(segments, selection)) {
    const key = `${s.app}\n${s.context ?? ''}\n${s.categoryId ?? ''}`;
    const entry = entries.get(key) ?? {
      app: s.app,
      context: s.context,
      categoryId: s.categoryId,
      categoryName: s.categoryName,
      color: s.color,
      seconds: 0,
      activityIds: [],
      ids: new Set<string>(),
    };
    entry.seconds += overlap(s.start, s.end, selection.from, selection.to) / 1000;
    entry.ids.add(s.activityId);
    entries.set(key, entry);
  }
  return [...entries.values()]
    .map(({ ids, ...entry }) => ({ ...entry, activityIds: [...ids] }))
    .sort((a, b) => b.seconds - a.seconds);
}

/** Every activity a selection touches, once each: what "categorize this" assigns. */
export function activitiesIn(segments: TimelineSegment[], selection: Selection): string[] {
  return [...new Set(inSelection(segments, selection).map((s) => s.activityId))];
}

/** The rule that catches exactly this entry: its app, and its context when it has one. */
export function ruleFor(entry: { app: string; context: string | null }): {
  appPattern: string;
  contextPattern: string | null;
} {
  return {
    appPattern: `^${escapeRegex(entry.app)}$`,
    contextPattern: entry.context === null ? null : `^${escapeRegex(entry.context)}$`,
  };
}

/** Rounds to the nearest `step` ms, so a drag lands on whole minutes. */
export const snap = (at: number, step: number): number => Math.round(at / step) * step;

/** Zoom levels, as how much of the day the view shows. */
export const ZOOMS = [
  { label: '24h', hours: 24 },
  { label: '12h', hours: 12 },
  { label: '6h', hours: 6 },
  { label: '3h', hours: 3 },
  { label: '1h', hours: 1 },
] as const;

/**
 * The visible window for a zoom, centred on `centre` where it can be, and
 * never past either end of the day.
 */
export function viewWindow(
  day: { start: number; end: number },
  hours: number,
  centre: number,
): { from: number; to: number } {
  const span = Math.min(hours * 3_600_000, day.end - day.start);
  const from = Math.min(Math.max(centre - span / 2, day.start), day.end - span);
  return { from, to: from + span };
}

/**
 * Where to draw hour marks: every hour zoomed in, fewer as the window widens.
 * Counted from `origin`, the day's local midnight, so they land on the user's
 * hours even in a zone half an hour off UTC.
 */
export function ticks(from: number, to: number, origin: number): number[] {
  const hours = (to - from) / 3_600_000;
  const step = (hours > 12 ? 3 : hours > 6 ? 2 : hours > 2 ? 1 : 0.25) * 3_600_000;
  const first = origin + Math.ceil((from - origin) / step) * step;
  const marks: number[] = [];
  for (let at = first; at <= to; at += step) marks.push(at);
  return marks;
}
