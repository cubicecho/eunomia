import type { Ping } from './ping.ts';

// Client-side privacy controls: sanitization runs before a ping is queued, so
// ignored apps and redacted titles never touch the outbox on disk, let alone
// the server. Patterns are case-insensitive regexes matched against the app
// identifier (executable / package name).

export interface PrivacyConfig {
  /** Apps whose pings are dropped entirely — the time shows up nowhere. */
  ignoreApps?: string[];
  /**
   * Apps whose title and context are stripped before upload — the time still
   * accrues to the app, but nothing about what was open in it leaves the
   * device.
   */
  redactApps?: string[];
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
  return (ping) => {
    if (matches(ignore, ping.app)) return null;
    if (matches(redact, ping.app)) return { ...ping, title: null, context: null };
    return ping;
  };
}
