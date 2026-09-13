// "Off the record": stretches of time the user asked not to be tracked.
//
// Local to the agent on purpose. The server never learns a pause happened —
// there is nothing to learn from it but "something the user didn't want seen
// happened here" — so it's enforced where pings are made: the desktop sampler
// skips its ticks, and the Android sync drops the pings it synthesizes for a
// paused stretch. Both shells keep their pauses as a list of windows rather
// than one flag because Android's pings are synthesized after the fact, from a
// usage log it reads minutes or hours later: it needs to know every stretch
// that was paused since its last checkpoint, not only whether one is paused
// now.
//
// What reaches the server across a pause is a gap, and the server treats it
// the way it treats every gap: the app focused before it accrues at most
// ACCRUE_CAP_SECONDS (30 s) against the next ping. That is the same small,
// bounded leak ignoreApps has.

/** One paused stretch, epoch ms. `to` null is "until resumed". */
export interface PauseWindow {
  from: number;
  to: number | null;
}

/** The pause lengths the tray and the status screen offer; null is until resumed. */
export const PAUSE_CHOICES: readonly { label: string; ms: number | null }[] = [
  { label: '30 minutes', ms: 30 * 60_000 },
  { label: '1 hour', ms: 60 * 60_000 },
  { label: 'Until resumed', ms: null },
];

/** Whether `at` falls inside any window. */
export function isPausedAt(windows: readonly PauseWindow[], at: number): boolean {
  return windows.some((window) => at >= window.from && (window.to === null || at < window.to));
}

/** The window covering `now`, or null when tracking. */
export function currentPause(windows: readonly PauseWindow[], now: number): PauseWindow | null {
  return (
    windows.find((window) => now >= window.from && (window.to === null || now < window.to)) ?? null
  );
}

/**
 * The windows after pausing at `now` for `ms` (null: until resumed). A pause
 * started while already paused replaces the current one from now on rather
 * than stacking — "1 hour" means an hour from the moment it was chosen.
 */
export function pause(
  windows: readonly PauseWindow[],
  now: number,
  ms: number | null,
): PauseWindow[] {
  return [...resume(windows, now), { from: now, to: ms === null ? null : now + ms }];
}

/** The windows after resuming at `now`: the current one, if any, ends here. */
export function resume(windows: readonly PauseWindow[], now: number): PauseWindow[] {
  return windows.map((window) =>
    now >= window.from && (window.to === null || now < window.to)
      ? { from: window.from, to: now }
      : window,
  );
}

/**
 * Drops windows that ended before `before`, and any empty ones — for a shell
 * that has already applied everything up to it (Android's sync checkpoint;
 * the sampler's clock).
 */
export function prunePauses(windows: readonly PauseWindow[], before: number): PauseWindow[] {
  return windows.filter(
    (window) =>
      (window.to === null || window.to >= before) && (window.to ?? Infinity) > window.from,
  );
}

/** A stored value read back as windows, dropping anything malformed. */
export function parsePauses(value: unknown): PauseWindow[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (window): window is PauseWindow =>
      typeof window === 'object' &&
      window !== null &&
      Number.isFinite(window.from) &&
      (window.to === null || Number.isFinite(window.to)),
  );
}
