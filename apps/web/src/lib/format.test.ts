import { afterEach, describe, expect, it, vi } from 'vitest';
import { addDays, dayIn, daysInRange, rangeOfLastDays, shortDay } from '@/lib/format';

describe('dayIn', () => {
  it("is the day in the user's zone, whatever the browser's is", () => {
    // 02:00 UTC on the 11th: still the 10th in Chicago, already the 11th in Tokyo.
    const instant = new Date('2026-08-11T02:00:00Z');
    expect(dayIn(instant, 'America/Chicago')).toBe('2026-08-10');
    expect(dayIn(instant, 'Asia/Tokyo')).toBe('2026-08-11');
    expect(dayIn(instant, 'UTC')).toBe('2026-08-11');
  });
});

describe('rangeOfLastDays', () => {
  afterEach(() => vi.useRealTimers());

  it("ends after today in the user's zone", () => {
    vi.useFakeTimers({ now: new Date('2026-08-26T01:00:00Z') });
    expect(rangeOfLastDays(7, 'America/Chicago')).toEqual({ from: '2026-08-19', to: '2026-08-26' });
    expect(rangeOfLastDays(1, 'Pacific/Kiritimati')).toEqual({
      from: '2026-08-26',
      to: '2026-08-27',
    });
  });
});

describe('calendar arithmetic', () => {
  it('counts whole days across a DST change and month ends', () => {
    // US clocks go back on 2026-11-01; a local-midnight Date would drift an hour.
    expect(addDays('2026-10-31', 2)).toBe('2026-11-02');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(daysInRange({ from: '2026-10-25', to: '2026-11-08' })).toBe(14);
    expect(addDays('not a day', 1)).toBe('not a day');
  });

  it('labels a date by the date, not by an instant', () => {
    expect(shortDay('2026-08-10')).toMatch(/10/);
    expect(shortDay('garbage')).toBe('garbage');
  });
});
