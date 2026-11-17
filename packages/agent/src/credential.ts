import { DeviceFlowError, REFRESH_MARGIN_MS, refreshTokens } from './device-flow.ts';

// What an agent signs in to its server with. It signs in as its person, in one
// of the two ways the server offers, the same two the other cubicecho apps'
// device clients use:
//
// - `provider`: the OIDC provider's device flow (device-flow.ts). An access
//   token for eunomia's API, kept fresh with the refresh token. Revoked at the
//   provider.
// - `session`: a sign-in link traded for a better-auth session token, which
//   the server renews as it is used. Revoked by signing it out.
//
// Either way the agent names its device on every upload; the credential says
// who, never which machine.

export type AgentCredential =
  | {
      kind: 'provider';
      accessToken: string;
      refreshToken: string | null;
      /** When the access token stops being good, epoch ms. */
      expiresAt: number;
      issuer: string;
      clientId: string;
      /** eunomia's API audience, asked for on every refresh. */
      audience: string;
      tokenEndpoint: string;
    }
  | { kind: 'session'; token: string };

const isString = (value: unknown): value is string => typeof value === 'string' && value !== '';

/** Reads a credential out of untrusted JSON, or null when it isn't a whole one. */
export function parseCredential(raw: unknown): AgentCredential | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;
  if (value.kind === 'session')
    return isString(value.token) ? { kind: 'session', token: value.token } : null;
  if (value.kind !== 'provider') return null;
  const { accessToken, refreshToken, expiresAt, issuer, clientId, audience, tokenEndpoint } = value;
  if (
    !isString(accessToken) ||
    typeof expiresAt !== 'number' ||
    !isString(issuer) ||
    !isString(clientId) ||
    !isString(audience) ||
    !isString(tokenEndpoint)
  ) {
    return null;
  }
  return {
    kind: 'provider',
    accessToken,
    refreshToken: isString(refreshToken) ? refreshToken : null,
    expiresAt,
    issuer,
    clientId,
    audience,
    tokenEndpoint,
  };
}

/** Thrown when the credential can no longer be made good: the person has to sign in again. */
export class SignedOutError extends Error {
  constructor(message = 'Signed out. Open setup and sign in again.') {
    super(message);
    this.name = 'SignedOutError';
  }
}

/**
 * Hands out the bearer for the next request, refreshing a provider token when
 * it is about to expire. Refreshed credentials go to `save` so a restart picks
 * them up, and to every listener (the dashboard window holds the same bearer).
 */
export interface TokenSource {
  /** The bearer to send now. Throws SignedOutError when there is no good one to get. */
  bearer(): Promise<string>;
  /**
   * After the server refused the bearer: refresh a provider token once more.
   * True when there is a new one worth retrying with.
   */
  recover(): Promise<boolean>;
  /** The credential as it stands, for whoever persists it. */
  current(): AgentCredential;
  /** Called with each new bearer. Returns the unsubscribe. */
  subscribe(listener: (bearer: string) => void): () => void;
}

export interface TokenSourceOptions {
  /** Persists a refreshed credential. A failure is logged, not thrown: the new token still works. */
  save?: (credential: AgentCredential) => void | Promise<void>;
  fetch?: typeof fetch;
  now?: () => number;
}

export function createTokenSource(
  initial: AgentCredential,
  options: TokenSourceOptions = {},
): TokenSource {
  const now = options.now ?? Date.now;
  let credential = initial;
  const listeners = new Set<(bearer: string) => void>();
  // One refresh at a time: a provider that rotates refresh tokens refuses the
  // second of two refreshes made with the same one, which would sign the agent
  // out for nothing.
  let refreshing: Promise<void> | null = null;

  const refresh = (stale: string): Promise<void> => {
    refreshing ??= (async () => {
      const current = credential;
      // Another caller refreshed while this one waited.
      if (current.kind !== 'provider' || current.accessToken !== stale) return;
      if (!current.refreshToken) throw new SignedOutError();
      try {
        const tokens = await refreshTokens(
          current.tokenEndpoint,
          current.clientId,
          current.refreshToken,
          current.audience,
          options.fetch,
          now,
        );
        credential = { ...current, ...tokens };
      } catch (error) {
        if (error instanceof DeviceFlowError && error.code === 'signed_out') {
          throw new SignedOutError();
        }
        throw error;
      }
      try {
        await options.save?.(credential);
      } catch (error) {
        console.error('could not save the refreshed sign-in', error);
      }
      for (const listener of listeners) listener(bearerOf(credential));
    })().finally(() => {
      refreshing = null;
    });
    return refreshing;
  };

  return {
    async bearer() {
      if (credential.kind === 'provider' && credential.expiresAt - REFRESH_MARGIN_MS <= now()) {
        await refresh(credential.accessToken);
      }
      return bearerOf(credential);
    },
    async recover() {
      if (credential.kind !== 'provider' || !credential.refreshToken) return false;
      await refresh(credential.accessToken);
      return true;
    },
    current: () => credential,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

const bearerOf = (credential: AgentCredential): string =>
  credential.kind === 'provider' ? credential.accessToken : credential.token;

/**
 * Hands every caller in a process the same token source for the same sign-in.
 * Two sources refreshing with one refresh token would race, and a provider
 * that rotates refresh tokens refuses the loser — signing the agent out. A
 * credential is the same sign-in when it is the one a source started from or
 * the one it refreshed to; anything else (a new sign-in from setup) gets a new
 * source.
 */
export function createTokenSourceCache(
  options: TokenSourceOptions = {},
): (credential: AgentCredential) => TokenSource {
  let cached: { started: string; source: TokenSource } | null = null;
  return (credential) => {
    const bearer = bearerOf(credential);
    if (cached && (cached.started === bearer || bearerOf(cached.source.current()) === bearer)) {
      return cached.source;
    }
    cached = { started: bearer, source: createTokenSource(credential, options) };
    return cached.source;
  };
}
