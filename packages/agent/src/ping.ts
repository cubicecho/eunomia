// The wire unit shared by every agent: a stateless report that "this is what
// the device looks like right now". The server folds pings into activity
// intervals (see apps/server/src/activity/fold.ts) — agents never track
// sessions themselves.

import type { PingInput } from './gql/sdk.ts';

/**
 * One ping, as the server declares it.
 *
 * `Required` rather than `PingInput` itself: the wire type makes the nullable
 * fields optional, and an agent that simply omits `title` when it can't read
 * one is indistinguishable from an agent that forgot to look. Every field is
 * spelled out here, and null is the answer to "the platform can't tell":
 *
 * - `app` — foreground app identifier (executable / package name).
 * - `title` — foreground window title or app label.
 * - `context` — sub-app division, e.g. the browser site's hostname. The server
 *   may still extract one from the title when this is null.
 * - `idleSeconds` — seconds since last input; 0 when the platform can't
 *   measure it but the user is present.
 *
 * Deriving it from the schema is also the drift check: a ping shape change on
 * the server breaks this package's typecheck at `npm run codegen`, rather than
 * showing up as rejected uploads in the field.
 */
export type Ping = Required<PingInput>;

/** Keep-alive cadence for live-sampling agents (desktop tray). */
export const PING_INTERVAL_MS = 10_000;

/** Default seconds between server syncs (outbox drains). Per-device override in AgentConfig. */
export const DEFAULT_SYNC_INTERVAL_SECONDS = 60;

/** Floor for user-set intervals, so a typo can't hammer the server. */
export const MIN_SYNC_INTERVAL_SECONDS = 10;

/** Resolves a config's sync interval to milliseconds — defaulted and floored. */
export function syncIntervalMs(config: { syncIntervalSeconds?: number }): number {
  const seconds = config.syncIntervalSeconds;
  if (typeof seconds !== 'number' || !Number.isFinite(seconds)) {
    return DEFAULT_SYNC_INTERVAL_SECONDS * 1000;
  }
  return Math.max(MIN_SYNC_INTERVAL_SECONDS, seconds) * 1000;
}

/** Pings per upload request. */
export const FLUSH_BATCH_SIZE = 50;
