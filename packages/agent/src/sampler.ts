import type { Outbox } from './outbox.ts';
import { PING_INTERVAL_MS, type Ping } from './ping.ts';
import type { PingSanitizer } from './privacy.ts';

// The live-sampling loop, shared by any agent that watches a foreground window
// (today: the desktop tray). It owns the decision of when to emit a ping and
// the record of whether sampling is working at all — the platform bindings
// (x-win, powerMonitor) stay in the app that has them.
//
// Sampler health is a first-class output, not a log line. A sampler that throws
// every tick is indistinguishable from a healthy one from the outside: the
// outbox simply stays empty, uploads keep succeeding, and the tray keeps
// claiming all is well. status() is what lets the UI say otherwise.

/** How often the loop looks at the OS. */
export const CHECK_INTERVAL_MS = 1_000;

/**
 * A gap between ticks longer than this is a stall, not jitter. Timers don't
 * catch up: a main thread blocked in a native call comes back to ONE late tick,
 * never to the ticks it swallowed, so the gap is the only evidence the stall
 * leaves behind.
 */
const STALL_AFTER_MS = 5 * CHECK_INTERVAL_MS;

/**
 * At most one failure line per this long. A sampler that throws on every tick
 * would otherwise write ~86k lines a day, and the agent log truncates at 512 KB
 * — a persistent failure would erase its own evidence roughly hourly.
 */
const ERROR_LOG_INTERVAL_MS = 60_000;

/**
 * Cadence of the "still sampling" summary line. The one thing agent.log could
 * never answer before is the plain question "was it tracking at 3pm?" — a
 * periodic count answers it for every half hour the agent was up, including
 * the half hours where every tick failed.
 */
export const HEARTBEAT_INTERVAL_MS = 30 * 60_000;

/** A sampler with this many consecutive failures is reported as not tracking. */
const UNHEALTHY_AFTER_FAILURES = 3;

/** What one tick reads off the OS. Null is "the platform can't tell". */
export interface Sample {
  /** Foreground app identifier (executable name). */
  app: string | null;
  /** Foreground window title. */
  title: string | null;
  /** Seconds since last input. */
  idleSeconds: number;
}

export interface SamplerDeps {
  outbox: Outbox;
  /** Reads the OS. Throwing is how a platform says it couldn't be asked. */
  read(): Sample;
  /**
   * Sub-app division for a sample — the browser hostname, which on Windows and
   * macOS is a cross-process accessibility round trip that can block for as
   * long as the other process is busy. Called only on ticks that emit, so it
   * costs once per ping rather than once per second.
   */
  readContext(sample: Sample): string | null;
  /**
   * The sanitizer to apply, read per tick: the privacy rules can be rewritten
   * from the setup window while the loop is running.
   */
  sanitize(): PingSanitizer;
  /** Injectable clock, for tests. */
  now?(): number;
}

export interface SamplerStatus {
  /** False when the OS has stopped answering — i.e. nothing is being tracked. */
  healthy: boolean;
  /** Epoch ms of the last tick that read the OS, or null if none ever has. */
  lastSampleAt: number | null;
  /** Epoch ms of the last ping queued, or null if none has been. */
  lastPingAt: number | null;
  /** Consecutive ticks that threw. */
  failures: number;
  /** Message from the most recent failure, or null while sampling works. */
  error: string | null;
}

export interface Sampler {
  /** One pass: read the OS, decide whether to emit, record what happened. */
  tick(): void;
  status(): SamplerStatus;
}

export function createSampler(deps: SamplerDeps): Sampler {
  const now = deps.now ?? Date.now;

  // What the last emitted ping said, so an unchanged foreground doesn't emit
  // more often than the keep-alive cadence.
  let last = { app: null as string | null, title: null as string | null, at: 0 };

  let lastTickAt: number | null = null;
  let lastSampleAt: number | null = null;
  let lastPingAt: number | null = null;
  let failures = 0;
  let error: string | null = null;
  let lastErrorLogAt = 0;
  let suppressedErrors = 0;
  let period = { since: now(), ticks: 0, pings: 0, failures: 0, stalls: 0 };

  /** One line per ERROR_LOG_INTERVAL_MS, carrying the count it stands for. */
  const logFailure = (at: number, message: string): void => {
    if (lastErrorLogAt > 0 && at - lastErrorLogAt < ERROR_LOG_INTERVAL_MS) {
      suppressedErrors++;
      return;
    }
    const also = suppressedErrors > 0 ? ` (and ${suppressedErrors} more since the last line)` : '';
    console.error(`sampling failed: ${message}${also}`);
    lastErrorLogAt = at;
    suppressedErrors = 0;
  };

  const heartbeat = (at: number): void => {
    if (at - period.since < HEARTBEAT_INTERVAL_MS) return;
    const minutes = Math.round((at - period.since) / 60_000);
    console.log(
      `sampler: ${period.ticks} ticks, ${period.pings} pings, ${period.failures} failures,` +
        ` ${period.stalls} stalls in the last ${minutes}m`,
    );
    period = { since: at, ticks: 0, pings: 0, failures: 0, stalls: 0 };
  };

  return {
    tick(): void {
      const at = now();
      heartbeat(at);
      if (lastTickAt !== null && at - lastTickAt > STALL_AFTER_MS) {
        period.stalls++;
        console.warn(`sampler stalled ${Math.round((at - lastTickAt) / 1000)}s — no ticks ran`);
      }
      lastTickAt = at;
      period.ticks++;

      try {
        const sample = deps.read();
        lastSampleAt = at;
        failures = 0;
        error = null;

        // The change check runs on what's cheap to read. A site change inside
        // one browser tab almost always moves the title too; when it somehow
        // doesn't, the keep-alive tick picks it up within PING_INTERVAL_MS.
        const changed = sample.app !== last.app || sample.title !== last.title;
        if (!changed && at - last.at < PING_INTERVAL_MS) return;

        // Sanitized before it exists anywhere: ignored and redacted data never
        // reaches the outbox file, let alone the server.
        const ping: Ping | null = deps.sanitize()({
          capturedAt: new Date(at).toISOString(),
          app: sample.app,
          title: sample.title,
          context: deps.readContext(sample),
          idleSeconds: sample.idleSeconds,
        });
        if (!ping) return; // ignored app — don't remember it as emitted

        deps.outbox.push(ping);
        lastPingAt = at;
        period.pings++;
        last = { app: sample.app, title: sample.title, at };
      } catch (caught) {
        failures++;
        period.failures++;
        error = caught instanceof Error ? caught.message : String(caught);
        logFailure(at, error);
      }
    },

    status: () => ({
      // Healthy until proven otherwise: the loop reports before its first
      // tick has run, and a fresh agent is not a broken one.
      healthy: failures < UNHEALTHY_AFTER_FAILURES,
      lastSampleAt,
      lastPingAt,
      failures,
      error,
    }),
  };
}
