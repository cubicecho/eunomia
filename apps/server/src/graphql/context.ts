import type { KeyScope } from '../api-keys.ts';
import type { Db } from '../db/client.ts';

export interface Context {
  db: Db;
  /** Authenticated dashboard user (session) or key owner (API key), if any. */
  userId: string | undefined;
  /**
   * The `apikey` row the request authenticated with. Set for both kinds of API
   * key and never for a session — which is what lets the permissions layer
   * keep key management to signed-in humans, so a leaked key cannot mint
   * itself a successor that outlives being revoked.
   */
  keyId: string | undefined;
  /** Set only when the request authenticated with a *device* API key. */
  deviceId: string | undefined;
  /**
   * What the request's integration key was minted to do beyond reading
   * (api-keys.ts KEY_SCOPES). Absent for sessions and keys without any.
   */
  keyScopes?: KeyScope[] | undefined;
  /** Original request headers — signOut needs them to find the session to revoke. */
  headers: Headers;
}
