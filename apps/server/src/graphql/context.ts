import type { Db } from '../db/client.ts';

export interface Context {
  db: Db;
  /** Authenticated dashboard user (session) or key owner (device API key), if any. */
  userId: string | undefined;
  /** Set only when the request authenticated with a device API key. */
  deviceId: string | undefined;
  /** Original request headers — signOut needs them to find the session to revoke. */
  headers: Headers;
}
