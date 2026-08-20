import { createServer } from 'node:http';
import { createYoga } from 'graphql-yoga';
import { startRollupTimer } from './activity/rollup.ts';
import { createAuth, createAuthGateway, verifyDeviceKey } from './auth.ts';
import { createDb } from './db/client.ts';
import type { Context } from './graphql/context.ts';
import { createSchema } from './graphql/schema.ts';
import { createStaticHandler } from './static.ts';

const db = createDb();
const auth = createAuth(db);

// Fold closed activities into the summaries table (once now, then periodic).
startRollupTimer(db);

// UNSAFE_LOCAL_NETWORK=true makes requestMagicLink return the sign-in token
// directly in the response — anyone who can reach the server can log in as
// any email. Only for trusted local networks / dev.
const unsafeLocalNetwork = process.env.UNSAFE_LOCAL_NETWORK === 'true';
if (unsafeLocalNetwork) {
  console.warn('[auth] UNSAFE_LOCAL_NETWORK is on: magic-link tokens are returned to callers');
}

// GraphQL is the only surface: no better-auth REST routes, no cookies. Auth
// happens through signUp/signIn/signOut mutations; sessions ride the
// `Authorization: Bearer <token>` header, device agents use `x-api-key`.
const yoga = createYoga<Record<string, never>, Context>({
  schema: createSchema(db, createAuthGateway(auth, { exposeMagicLinkToken: unsafeLocalNetwork })),
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

// WEB_DIST points at the built dashboard (set in the container image); the
// server then serves it on every non-/graphql path, so one origin hosts both
// and the SPA's relative /graphql calls need no proxy. Unset in dev, where
// vite serves the dashboard itself.
const webDist = process.env.WEB_DIST;
const serveStatic = webDist ? createStaticHandler(webDist) : null;
if (webDist) console.log(`serving web dashboard from ${webDist}`);

const server = createServer((req, res) => {
  const path = (req.url ?? '/').split('?')[0];
  if (serveStatic && path !== yoga.graphqlEndpoint) {
    serveStatic(req, res);
    return;
  }
  void yoga(req, res);
});

const port = Number(process.env.PORT ?? 4000);
// Bind all interfaces by default — the server typically runs in a container
// or on a remote VM, where a localhost-only bind would be unreachable.
const host = process.env.HOST ?? '0.0.0.0';
server.listen(port, host, () => {
  console.log(`eunomia server listening on http://${host}:${port}${yoga.graphqlEndpoint}`);
});
