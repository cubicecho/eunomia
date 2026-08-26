/**
 * BETTER_AUTH_SECRET signs every session token and hashes every magic link, so
 * a missing or published value means anyone can mint a session for any user.
 * The server refuses to start on one rather than come up quietly forgeable.
 */
const PUBLISHED_SECRETS = new Set(['dev-secret-change-me', 'change-me', 'secret', 'changeme']);

/** Shorter than this is guessable enough to be worth complaining about. */
const MIN_SECRET_LENGTH = 32;

/** A reason to refuse to boot, or null. */
export function secretProblem(secret: string | undefined): string | null {
  const value = secret?.trim();
  if (!value) return 'BETTER_AUTH_SECRET is not set';
  if (PUBLISHED_SECRETS.has(value.toLowerCase())) {
    return 'BETTER_AUTH_SECRET is still an example value from this repo';
  }
  return null;
}

/** A reason to complain loudly but keep going, or null. */
export function secretWarning(secret: string | undefined): string | null {
  const value = secret?.trim() ?? '';
  if (value.length > 0 && value.length < MIN_SECRET_LENGTH) {
    return `BETTER_AUTH_SECRET is only ${value.length} characters; use at least ${MIN_SECRET_LENGTH}`;
  }
  return null;
}

export const SECRET_HELP =
  'Generate one with `openssl rand -base64 32` and set it in .env.\n' +
  'UNSAFE_LOCAL_NETWORK=true skips this check for throwaway local runs.';
