import type { Ping } from './ping.ts';

// Client-side privacy controls: sanitization runs before a ping is queued, so
// ignored apps, redacted titles and detail below the capture level never touch
// the ping log on disk, let alone the server. Patterns are case-insensitive
// regexes matched against the app identifier (executable / package name).

/**
 * How much of each ping this device keeps, least to most:
 *
 * - `app` — the app alone; title and context are stripped.
 * - `context` — the app plus the context the agent read itself (a browser
 *   site's hostname); the title is stripped.
 * - `title` — everything the platform can read. The default.
 *
 * `context` keeps only what the agent can supply. The server's context rules
 * extract a project or document from the title, and a title that never leaves
 * the device can't be matched — so at `context` those contexts are lost, and
 * only an agent-read one survives (a browser hostname on Windows/macOS; Linux
 * and Android read none today). Sending the title for the server to discard
 * after extraction would break the promise the level makes: that it never
 * leaves the device.
 */
export const CAPTURE_LEVELS = ['app', 'context', 'title'] as const;

export type CaptureLevel = (typeof CAPTURE_LEVELS)[number];

/** What an install that never chose gets: the full detail it always sent. */
export const DEFAULT_CAPTURE_LEVEL: CaptureLevel = 'title';

export const isCaptureLevel = (value: unknown): value is CaptureLevel =>
  CAPTURE_LEVELS.includes(value as CaptureLevel);

export interface PrivacyConfig {
  /** Apps whose pings are dropped entirely — the time shows up nowhere. */
  ignoreApps?: string[];
  /**
   * Apps whose title and context are stripped before upload — the time still
   * accrues to the app, but nothing about what was open in it leaves the
   * device.
   */
  redactApps?: string[];
  /** Detail kept for every app on this device. Default DEFAULT_CAPTURE_LEVEL. */
  captureLevel?: CaptureLevel;
}

export type PingSanitizer = (ping: Ping) => Ping | null;

/** Compiles patterns, skipping invalid regexes — a typo must not kill tracking. */
function compile(patterns: string[] | undefined): RegExp[] {
  const compiled: RegExp[] = [];
  for (const pattern of patterns ?? []) {
    try {
      compiled.push(new RegExp(pattern, 'i'));
    } catch {
      console.error(`invalid privacy pattern skipped: ${pattern}`);
    }
  }
  return compiled;
}

const matches = (regexes: RegExp[], app: string | null): boolean =>
  app !== null && regexes.some((regex) => regex.test(app));

export function createSanitizer(config: PrivacyConfig): PingSanitizer {
  const ignore = compile(config.ignoreApps);
  const redact = compile(config.redactApps);
  // An unrecognized level falls back to the default, as parseConfig does.
  const level = isCaptureLevel(config.captureLevel) ? config.captureLevel : DEFAULT_CAPTURE_LEVEL;
  return (ping) => {
    if (matches(ignore, ping.app)) return null;
    // Redacting an app captures it at `app`, whatever the device's level.
    if (level === 'app' || matches(redact, ping.app)) {
      return { ...ping, title: null, context: null };
    }
    if (level === 'context') return { ...ping, title: null };
    return ping;
  };
}
