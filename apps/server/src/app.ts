import type { GraphQLSchema } from 'graphql';
import { createYoga } from 'graphql-yoga';
import { type Auth, type AuthGateway, verifyDeviceKey } from './auth.ts';
import type { Db } from './db/client.ts';
import type { Context } from './graphql/context.ts';
import { createSchema } from './graphql/schema.ts';

/**
 * Resolves who is calling, from the request headers alone.
 *
 * Split out of the Yoga context below because /mcp answers the same identities
 * over a different transport, and "the MCP endpoint authenticates like GraphQL"
 * has to be a shared function rather than a claim two copies both make.
 */
export function createContextFactory(db: Db, auth: Auth) {
  return async (headers: Headers): Promise<Context> => {
    const apiKey = headers.get('x-api-key');
    if (apiKey) {
      const creds = await verifyDeviceKey(auth, apiKey);
      return { db, userId: creds?.userId, deviceId: creds?.deviceId, headers };
    }
    const session = await auth.api.getSession({ headers });
    return { db, userId: session?.user.id, deviceId: undefined, headers };
  };
}

/**
 * The GraphQL app: schema + per-request identity. Separate from index.ts so
 * tests can drive the real HTTP surface — resolver-level `graphql()` calls
 * never see Yoga's error masking, which is exactly where "Unknown device"
 * quietly became "Unexpected error." for every client.
 *
 * GraphQL is the only surface: no better-auth REST routes, no cookies. Auth
 * happens through signUp/signIn/signOut mutations; sessions ride the
 * `Authorization: Bearer <token>` header, device agents use `x-api-key`.
 *
 * `schema` is a parameter so index.ts can build it once and hand the same
 * instance to the MCP endpoint — the permissions are applied during assembly,
 * so sharing the instance is what makes the two surfaces provably the same API.
 */
export function createApp(
  db: Db,
  auth: Auth,
  gateway: AuthGateway,
  schema: GraphQLSchema = createSchema(db, gateway),
) {
  const contextFor = createContextFactory(db, auth);
  return createYoga<Record<string, never>, Context>({
    schema,
    context: ({ request }) => contextFor(request.headers),
  });
}
