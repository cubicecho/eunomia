import { describe, expect, it } from 'vitest';
import { currentPause, isPausedAt, parsePauses, pause, prunePauses, resume } from './pause.ts';

describe('pause windows', () => {
  it('pauses for a while, or until resumed', () => {
    const timed = pause([], 1000, 500);
    expect(timed).toEqual([{ from: 1000, to: 1500 }]);
    expect(isPausedAt(timed, 999)).toBe(false);
    expect(isPausedAt(timed, 1000)).toBe(true);
    expect(isPausedAt(timed, 1499)).toBe(true);
    // It ends on its own.
    expect(isPausedAt(timed, 1500)).toBe(false);
    expect(currentPause(timed, 1500)).toBeNull();

    const open = pause([], 1000, null);
    expect(currentPause(open, 10_000_000)).toEqual({ from: 1000, to: null });
  });

  it('resumes early, and a new pause replaces the current one from now', () => {
    const resumed = resume(pause([], 1000, null), 1200);
    expect(resumed).toEqual([{ from: 1000, to: 1200 }]);
    expect(isPausedAt(resumed, 1100)).toBe(true);
    expect(isPausedAt(resumed, 1200)).toBe(false);
    // Resuming while tracking changes nothing.
    expect(resume(resumed, 5000)).toEqual(resumed);

    const extended = pause(pause([], 1000, 500), 1400, 1000);
    expect(extended).toEqual([
      { from: 1000, to: 1400 },
      { from: 1400, to: 2400 },
    ]);
    expect(isPausedAt(extended, 2000)).toBe(true);
  });

  it('prunes what has been applied, keeping anything still open', () => {
    const windows = [
      { from: 0, to: 100 },
      { from: 200, to: 200 },
      { from: 300, to: 400 },
      { from: 500, to: null },
    ];
    expect(prunePauses(windows, 350)).toEqual([
      { from: 300, to: 400 },
      { from: 500, to: null },
    ]);
  });

  it('reads back only well-formed windows', () => {
    expect(parsePauses(null)).toEqual([]);
    expect(
      parsePauses([{ from: 1, to: null }, { from: 'x', to: 2 }, { from: 3, to: 4 }, null]),
    ).toEqual([
      { from: 1, to: null },
      { from: 3, to: 4 },
    ]);
  });
});
