import { createYoga } from 'graphql-yoga';
import { type Auth, type AuthGateway, verifyDeviceKey } from './auth.ts';
import type { Db } from './db/client.ts';
import type { Context } from './graphql/context.ts';
import { createSchema } from './graphql/schema.ts';

/**
 * The GraphQL app: schema + per-request identity. Separate from index.ts so
 * tests can drive the real HTTP surface — resolver-level `graphql()` calls
 * never see Yoga's error masking, which is exactly where "Unknown device"
 * quietly became "Unexpected error." for every client.
 *
 * GraphQL is the only surface: no better-auth REST routes, no cookies. Auth
 * happens through signUp/signIn/signOut mutations; sessions ride the
 * `Authorization: Bearer <token>` header, device agents use `x-api-key`.
 */
export function createApp(db: Db, auth: Auth, gateway: AuthGateway) {
  return createYoga<Record<string, never>, Context>({
    schema: createSchema(db, gateway),
    context: async ({ request }) => {
      const headers = request.headers;
      const apiKey = headers.get('x-api-key');
      if (apiKey) {
        const creds = await verifyDeviceKey(auth, apiKey);
        return { db, userId: creds?.userId, deviceId: creds?.deviceId, headers };
      }
      const session = await auth.api.getSession({ headers });
      return { db, userId: session?.user.id, deviceId: undefined, headers };
    },
  });
}
