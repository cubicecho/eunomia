import { describe, expect, it } from 'vitest';
import {
  activitiesIn,
  clip,
  dayBounds,
  lanes,
  ruleFor,
  type Selection,
  snap,
  summarize,
  type TimelineSegment,
  ticks,
  viewWindow,
} from '@/lib/timeline';

const HOUR = 3_600_000;
const T0 = Date.parse('2026-08-16T00:00:00Z');

const seg = (
  id: string,
  startMin: number,
  endMin: number,
  extra: Partial<TimelineSegment> = {},
): TimelineSegment => ({
  id,
  deviceId: 'laptop',
  activityId: `a-${id}`,
  start: T0 + startMin * 60_000,
  end: T0 + endMin * 60_000,
  app: 'code',
  context: null,
  title: null,
  categoryId: null,
  categoryName: null,
  color: null,
  ...extra,
});

describe('timeline', () => {
  it('finds a day in the user’s zone, DST days included', () => {
    expect(dayBounds('2026-08-16', 'UTC')).toEqual({ start: T0, end: T0 + 24 * HOUR });
    const chicago = dayBounds('2026-08-16', 'America/Chicago');
    expect(chicago.start).toBe(T0 + 5 * HOUR);
    // Spring forward: a 23-hour day.
    const short = dayBounds('2026-03-08', 'America/Chicago');
    expect(short.end - short.start).toBe(23 * HOUR);
  });

  it('cuts segments to the window and keeps zero-length ones', () => {
    const clipped = clip(
      [seg('a', 0, 30), seg('b', 50, 70), seg('c', 90, 90), seg('d', 200, 210)],
      T0 + 10 * 60_000,
      T0 + 100 * 60_000,
    );
    expect(clipped.map((s) => [s.id, (s.start - T0) / 60_000, (s.end - T0) / 60_000])).toEqual([
      ['a', 10, 30],
      ['b', 50, 70],
      ['c', 90, 90],
    ]);
  });

  it('puts each device in its own lane, in time order', () => {
    const byDevice = lanes([
      seg('b', 20, 30),
      seg('p', 0, 5, { deviceId: 'phone' }),
      seg('a', 0, 10),
    ]);
    expect([...byDevice.keys()].sort()).toEqual(['laptop', 'phone']);
    expect(byDevice.get('laptop')?.map((s) => s.id)).toEqual(['a', 'b']);
  });

  it('summarizes a selection by the time inside it, not the whole activity', () => {
    const segments = [
      seg('a', 0, 60, { app: 'code', context: 'eunomia' }),
      seg('b', 60, 90, { app: 'firefox', context: 'docs.example' }),
      seg('c', 90, 120, { app: 'code', context: 'eunomia', activityId: 'a-a' }),
      seg('p', 0, 120, { deviceId: 'phone', app: 'chrome' }),
    ];
    const laptop: Selection = { deviceId: 'laptop', from: T0 + 30 * 60_000, to: T0 + 100 * 60_000 };
    expect(summarize(segments, laptop)).toEqual([
      expect.objectContaining({
        app: 'code',
        context: 'eunomia',
        seconds: 40 * 60,
        activityIds: ['a-a'],
      }),
      expect.objectContaining({ app: 'firefox', seconds: 30 * 60, activityIds: ['a-b'] }),
    ]);
    expect(activitiesIn(segments, laptop).sort()).toEqual(['a-a', 'a-b']);
    // Every device when the selection names none.
    expect(activitiesIn(segments, { ...laptop, deviceId: null })).toContain('a-p');
  });

  it('writes a rule that catches exactly one entry', () => {
    expect(ruleFor({ app: 'code', context: 'my.site (beta)' })).toEqual({
      appPattern: '^code$',
      contextPattern: '^my\\.site \\(beta\\)$',
    });
    expect(ruleFor({ app: 'slack', context: null }).contextPattern).toBeNull();
  });

  it('zooms within the day and never past its ends', () => {
    const day = { start: T0, end: T0 + 24 * HOUR };
    expect(viewWindow(day, 24, T0 + 3 * HOUR)).toEqual({ from: T0, to: T0 + 24 * HOUR });
    expect(viewWindow(day, 6, T0 + 12 * HOUR)).toEqual({ from: T0 + 9 * HOUR, to: T0 + 15 * HOUR });
    expect(viewWindow(day, 6, T0 + HOUR)).toEqual({ from: T0, to: T0 + 6 * HOUR });
    expect(viewWindow(day, 6, T0 + 23 * HOUR)).toEqual({ from: T0 + 18 * HOUR, to: day.end });
  });

  it('marks local hours, even half an hour off UTC', () => {
    const india = dayBounds('2026-08-16', 'Asia/Kolkata');
    const marks = ticks(india.start, india.end, india.start);
    expect(marks).toHaveLength(9);
    expect(marks[1]! - india.start).toBe(3 * HOUR);
    expect(ticks(T0, T0 + HOUR, T0)).toHaveLength(5);
  });

  it('snaps to whole minutes', () => {
    expect(snap(T0 + 89_000, 60_000)).toBe(T0 + 60_000);
    expect(snap(T0 + 91_000, 60_000)).toBe(T0 + 120_000);
  });
});
