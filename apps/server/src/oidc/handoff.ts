import { createHash, timingSafeEqual } from 'node:crypto';

// Where a finished OIDC sign-in is handed over, when it isn't the dashboard.
//
// The desktop and Android agents sign in through the system browser, so the
// one-time token has to reach an app rather than a page: the Android app's own
// URL scheme, or a port the desktop app is listening on for just this sign-in
// (RFC 8252's loopback redirect). Those are the only targets accepted — a
// sign-in may never be sent to an arbitrary site.
//
// Either target can be intercepted by something else on the same device: an
// app that registered the same scheme, a process that grabbed the port. So an
// agent sign-in is bound to the agent that started it, PKCE-style: the agent
// sends a challenge (S256 of a secret verifier it keeps), and the one-time
// token minted for that sign-in is refused unless the verifier comes with it.

/** The Android app's URL scheme (app.json `scheme`). */
export const AGENT_SCHEME = 'eunomia:';

/** How long an agent has to come back from the provider: the cookie's lifetime. */
const RETURN_TTL_SECONDS = 10 * 60;
/** As long as a one-time token lives (auth.ts), plus slack. */
const CHALLENGE_TTL_MS = 5 * 60_000;

/** The cookie the start route leaves for the callback, on the server's origin. */
export const RETURN_COOKIE = 'eunomia_sso_return';

export interface ReturnTarget {
  /** Where the browser goes with `?sso=` or `?error=`. */
  to: string;
  /** base64url(S256(verifier)). */
  challenge: string;
}

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

/** The return URL if it is one an agent may use, else null. */
export function allowedReturn(value: string | null | undefined): string | null {
  if (!value || !URL.canParse(value)) return null;
  const url = new URL(value);
  if (url.protocol === AGENT_SCHEME) return url.toString();
  // Plain http on purpose: the hop never leaves the machine.
  if (url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname) && url.port !== '') {
    return url.toString();
  }
  return null;
}

/** base64url, 43 characters: what an S256 challenge of any verifier looks like. */
const CHALLENGE_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** A return target from the start route's query, or null when it asks for none or a bad one. */
export function returnFromQuery(query: URLSearchParams): ReturnTarget | null {
  const to = allowedReturn(query.get('return_to'));
  const challenge = query.get('code_challenge') ?? '';
  if (!to || !CHALLENGE_PATTERN.test(challenge)) return null;
  return { to, challenge };
}

export function returnCookie(target: ReturnTarget | null): string {
  const value = target ? Buffer.from(JSON.stringify(target)).toString('base64url') : '';
  const maxAge = target ? RETURN_TTL_SECONDS : 0;
  return `${RETURN_COOKIE}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax`;
}

/**
 * The target the start route left, re-checked: the cookie is the browser's to
 * edit, so it is validated again rather than trusted.
 */
export function returnFromCookie(header: string | undefined): ReturnTarget | null {
  const raw = header
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${RETURN_COOKIE}=`))
    ?.slice(RETURN_COOKIE.length + 1);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(
      Buffer.from(raw, 'base64url').toString('utf8'),
    ) as Partial<ReturnTarget>;
    const to = allowedReturn(parsed.to);
    const challenge = typeof parsed.challenge === 'string' ? parsed.challenge : '';
    return to && CHALLENGE_PATTERN.test(challenge) ? { to, challenge } : null;
  } catch {
    return null;
  }
}

/** `to` with one query parameter set. */
export function withParam(to: string, name: string, value: string): string {
  const url = new URL(to);
  url.searchParams.set(name, value);
  return url.toString();
}

// Every one-time token an OIDC callback minted, and the challenge it is bound
// to (null for the dashboard's). In memory: a token lives three minutes and
// eunomia runs as one process. A token this map doesn't know is refused, so a
// restart in between costs one sign-in and never drops a binding.
const challenges = new Map<string, { challenge: string | null; expires: number }>();

const tokenKey = (token: string): string => createHash('sha256').update(token).digest('hex');

export function bindChallenge(token: string, challenge: string | null): void {
  const now = Date.now();
  for (const [key, entry] of challenges) if (entry.expires <= now) challenges.delete(key);
  challenges.set(tokenKey(token), { challenge, expires: now + CHALLENGE_TTL_MS });
}

export const s256 = (verifier: string): string =>
  createHash('sha256').update(verifier).digest('base64url');

/**
 * Whether `verifier` unlocks `token`. A token minted for the dashboard has no
 * challenge and needs none; one minted for an agent needs the verifier that
 * agent kept; one never minted here is refused. Checked before the token is
 * spent, so a wrong guess doesn't burn the real agent's sign-in.
 */
export function verifierMatches(token: string, verifier: string | null | undefined): boolean {
  const entry = challenges.get(tokenKey(token));
  if (!entry || entry.expires <= Date.now()) return false;
  if (entry.challenge === null) return true;
  if (!verifier) return false;
  const expected = Buffer.from(entry.challenge);
  const actual = Buffer.from(s256(verifier));
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/** Forgets a token's challenge once the token is spent. */
export function releaseChallenge(token: string): void {
  challenges.delete(tokenKey(token));
}
