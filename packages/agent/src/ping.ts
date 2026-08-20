// The wire unit shared by every agent: a stateless report that "this is what
// the device looks like right now". The server folds pings into activity
// intervals (see apps/server/src/activity/fold.ts) — agents never track
// sessions themselves.

export interface Ping {
  capturedAt: string;
  /** Foreground app identifier (executable / package name). Null if undetectable. */
  app: string | null;
  /** Foreground window title or app label. Null if unavailable. */
  title: string | null;
  /**
   * Sub-app division — e.g. the browser site's hostname. Null when the
   * platform can't tell; the server may still extract one from the title.
   */
  context: string | null;
  /** Seconds since last input. 0 when the platform can't measure it but the user is present. */
  idleSeconds: number;
}

// Compile-time drift check: every Ping must remain valid recordPing arguments,
// so a server-side change to the mutation breaks this package's typecheck.
import type { MutationRecordPingArgs } from './gql/sdk.ts';
type AssertWireCompatible<_T extends MutationRecordPingArgs> = never;
export type _PingWireCheck = AssertWireCompatible<Ping>;

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
