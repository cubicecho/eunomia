import type { GraphQLSchema } from 'graphql';
import { createYoga, type Plugin } from 'graphql-yoga';
import { type AuthGateway, verifyApiKey } from './auth.ts';
import type { AuthHost } from './auth-host.ts';
import type { Db } from './db/client.ts';
import { type Context, Credential } from './graphql/context.ts';
import { createSchema } from './graphql/schema.ts';
import { serverUrl } from './oidc/config.ts';
import { PROTECTED_RESOURCE_PATH } from './oidc/protected-resource.ts';
import { looksLikeJwt, userForSubject } from './oidc/provider-tokens.ts';

/** The scheme a session token or a provider access token is sent under. */
const BEARER_PREFIX = 'Bearer ';

/** The token a request sends as `Authorization: Bearer`, or null. */
function bearerOf(headers: Headers): string | null {
  const authorization = headers.get('authorization') ?? '';
  return authorization.startsWith(BEARER_PREFIX)
    ? authorization.slice(BEARER_PREFIX.length).trim()
    : null;
}

/**
 * Resolves who is calling, from the request headers alone. The first
 * credential the request carries decides, and one that does not hold is
 * nobody, never a fall through to the next:
 *
 * 1. `x-api-key`: an integration key, acting as its owner. A revoked or
 *    expired key is nobody even beside a live session or token, so the program
 *    hears UNAUTHENTICATED rather than acting as whoever else the headers name.
 * 2. `Authorization: Bearer <JWT>`: an access token the OIDC provider issued
 *    for this API (an agent that ran the device flow), while there is a
 *    provider, mapped to the account that signed in through it by the token's
 *    `sub`. A session token has no dots, so a JWT never costs a session lookup.
 * 3. `Authorization: Bearer <session>`: a person, on a better-auth session.
 *
 * Split out of the Yoga context below because /mcp answers the same identities
 * over a different transport, and "the MCP endpoint authenticates like GraphQL"
 * has to be a shared function rather than a claim two copies both make.
 */
export function createContextFactory(db: Db, host: AuthHost) {
  return async (headers: Headers): Promise<Context> => {
    const nobody: Context = {
      db,
      userId: undefined,
      credential: undefined,
      keyId: undefined,
      headers,
    };
    // Asked per request: pairing an OIDC provider swaps the instance while the
    // server runs (auth-host.ts).
    const auth = host.current();
    const apiKey = headers.get('x-api-key');
    if (apiKey) {
      const creds = await verifyApiKey(auth, apiKey);
      if (!creds) return nobody;
      return {
        ...nobody,
        userId: creds.userId,
        credential: Credential.ApiKey,
        keyId: creds.keyId,
        keyScopes: creds.scopes,
      };
    }
    const bearer = bearerOf(headers);
    if (bearer !== null && looksLikeJwt(bearer)) {
      const verified = await host.providerTokens()?.verify(bearer);
      const userId = verified ? await userForSubject(db, verified.sub) : null;
      return userId ? { ...nobody, userId, credential: Credential.ProviderToken } : nobody;
    }
    const session = await auth.api.getSession({ headers });
    return session
      ? { ...nobody, userId: session.user.id, credential: Credential.Session }
      : nobody;
  };
}

/**
 * The `WWW-Authenticate` challenge for a request whose bearer was refused,
 * while there is a provider to get a good one from (RFC 6750 §3, RFC 9728
 * §5.1): it points an agent at the protected-resource metadata. GraphQL answers
 * a refused credential with HTTP 200 and UNAUTHENTICATED on the field, never
 * 401, so the challenge rides on that 200.
 */
export function bearerChallenge(host: AuthHost, ctx: Context): string | null {
  const hasBearer = ctx.headers.get('authorization')?.startsWith(BEARER_PREFIX) ?? false;
  if (host.oidc() === null || ctx.userId || !hasBearer) return null;
  return `Bearer error="invalid_token", resource_metadata="${serverUrl()}${PROTECTED_RESOURCE_PATH}"`;
}

/**
 * The GraphQL app: schema + per-request identity. Separate from index.ts so
 * tests can drive the real HTTP surface — resolver-level `graphql()` calls
 * never see Yoga's error masking, which is exactly where "Unknown device"
 * quietly became "Unexpected error." for every client.
 *
 * GraphQL is the only surface: no better-auth REST routes, no cookies. Auth
 * happens through signUp/signIn/signOut mutations; sessions ride the
 * `Authorization: Bearer <token>` header, as do the agents' provider access
 * tokens; integration keys use `x-api-key`.
 *
 * `schema` is a parameter so index.ts can build it once and hand the same
 * instance to the MCP endpoint — the permissions are applied during assembly,
 * so sharing the instance is what makes the two surfaces provably the same API.
 */
export function createApp(
  db: Db,
  host: AuthHost,
  gateway: AuthGateway,
  schema: GraphQLSchema = createSchema(db, gateway),
) {
  const contextFor = createContextFactory(db, host);
  // The challenge is decided while building the context and written onto the
  // response afterwards; the request is what ties the two together.
  const challenges = new WeakMap<Request, string>();
  const challengePlugin: Plugin = {
    onResponse({ request, response }) {
      const challenge = challenges.get(request);
      if (challenge) response.headers.set('WWW-Authenticate', challenge);
    },
  };
  return createYoga<Record<string, never>, Context>({
    schema,
    plugins: [challengePlugin],
    context: async ({ request }) => {
      const context = await contextFor(request.headers);
      const challenge = bearerChallenge(host, context);
      if (challenge) challenges.set(request, challenge);
      return { ...context, signal: request.signal };
    },
  });
}
