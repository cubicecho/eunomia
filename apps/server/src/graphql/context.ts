import type { KeyScope } from '../api-keys.ts';
import type { Db } from '../db/client.ts';

/** What a request proved who it is with. */
export const Credential = {
  /** A person, on a better-auth session: the dashboard, or an agent signed in by a link. */
  Session: 'session',
  /** An integration key issued from the dashboard: an MCP client, a script. */
  ApiKey: 'apiKey',
  /** An access token the OIDC provider issued for this API: an agent that ran the device flow. */
  ProviderToken: 'providerToken',
} as const;
export type Credential = (typeof Credential)[keyof typeof Credential];

export interface Context {
  db: Db;
  /** Who the request is: the session's user, the key's owner, or the token's account. */
  userId: string | undefined;
  /** What they proved it with; undefined for nobody. */
  credential: Credential | undefined;
  /** The `apikey` row the request authenticated with. Set only for an integration key. */
  keyId: string | undefined;
  /**
   * What the request's integration key was minted to do beyond reading
   * (api-keys.ts KEY_SCOPES). Absent for everything else.
   */
  keyScopes?: KeyScope[] | undefined;
  /** Original request headers — signOut needs them to find the session to revoke. */
  headers: Headers;
  /**
   * Fires when the caller goes away. Set by /graphql from Yoga's request, so
   * a closed dashboard stops a slow model instead of holding it until timeout.
   */
  signal?: AbortSignal | undefined;
}

/**
 * Whether the request is a person on a session. An integration key and a
 * provider token both act as their user on every row, but a key that could
 * mint keys could mint its own successor, and a token that could would leave a
 * credential behind that outlives it and the provider's say over it — so
 * issuing and withdrawing credentials, and the other session-only fields, stay
 * with the human who signs in.
 */
export const isSession = (ctx: Pick<Context, 'userId' | 'credential'>): boolean =>
  Boolean(ctx.userId) && ctx.credential === Credential.Session;
