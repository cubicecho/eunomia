import type { KeyScope } from '../../src/api-keys.ts';
import type { Db } from '../../src/db/client.ts';
import { type Context, Credential } from '../../src/graphql/context.ts';

// Contexts as createContextFactory builds them, for tests that run the schema
// directly. A caller is a session, an integration key or a provider token;
// no userId is nobody.

type TestDb = Context['db'] | Db;

/** A signed-in person on a session, or nobody when `userId` is empty. */
export function sessionContext(db: TestDb, userId: string | null | undefined): Context {
  return {
    db: db as Context['db'],
    userId: userId ?? undefined,
    credential: userId ? Credential.Session : undefined,
    keyId: undefined,
    headers: new Headers(),
  };
}

/** The same person, reached through one of their integration keys. */
export function keyContext(
  db: TestDb,
  userId: string,
  keyId: string,
  keyScopes?: KeyScope[],
): Context {
  return { ...sessionContext(db, userId), credential: Credential.ApiKey, keyId, keyScopes };
}

/** The same person, on an access token their OIDC provider issued (an agent). */
export function tokenContext(db: TestDb, userId: string): Context {
  return { ...sessionContext(db, userId), credential: Credential.ProviderToken };
}
