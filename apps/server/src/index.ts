import { createServer } from 'node:http';
import { startReplayTimer } from './activity/replay.ts';
import { startRollupTimer } from './activity/rollup.ts';
import { createApp, createContextFactory } from './app.ts';
import { createAuthGateway } from './auth.ts';
import { createAuthHost } from './auth-host.ts';
import { createDb } from './db/client.ts';
import { SECRET_HELP, secretProblem, secretWarning } from './env.ts';
import { createSchema } from './graphql/schema.ts';
import { checkHealth, VERSION } from './health.ts';
import { storedSessionSecret } from './instance-secret.ts';
import { createMcpHandler } from './mcp.ts';
import { appUrl, oidcEnvProblem, oidcRedirectUri } from './oidc/config.ts';
import { createSsoHandler } from './oidc/http.ts';
import { hasUsers } from './oidc/settings.ts';
import { registrationPolicyFromEnv } from './registration.ts';
import { SetupCode, setupCodeBanner } from './setup-code.ts';
import { createStaticHandler } from './static.ts';

// UNSAFE_LOCAL_NETWORK=true makes requestMagicLink return the sign-in token
// directly in the response — anyone who can reach the server can log in as
// any email. Only for trusted local networks / dev.
const unsafeLocalNetwork = process.env.UNSAFE_LOCAL_NETWORK === 'true';
if (unsafeLocalNetwork) {
  console.warn('[auth] UNSAFE_LOCAL_NETWORK is on: magic-link tokens are returned to callers');
}

// Checked before anything connects: a forgeable session secret is not a
// warning, it is an open door, and a server that boots anyway will be running
// for months before anyone notices. Unset is fine: one is generated and kept
// in the database below. A value copied from this repo is not.
const secret = process.env.BETTER_AUTH_SECRET?.trim() || undefined;
const problem = secret ? secretProblem(secret) : null;
if (problem && !unsafeLocalNetwork) {
  console.error(`[auth] refusing to start: ${problem}.\n${SECRET_HELP}`);
  process.exit(1);
}
if (problem) console.warn(`[auth] ${problem} (allowed by UNSAFE_LOCAL_NETWORK)`);
const warning = secretWarning(secret);
if (warning) console.warn(`[auth] ${warning}`);

// Half an OIDC setup leaves the sign-in page without its button and no clue
// why, and a typo in the issuer would only show at the first sign-in.
const oidcProblem = oidcEnvProblem();
if (oidcProblem) {
  console.error(`[auth] refusing to start: ${oidcProblem}.`);
  process.exit(1);
}

const db = createDb();

if (!secret) {
  // Before anything builds better-auth, which reads it from the environment.
  const stored = await storedSessionSecret(db);
  process.env.BETTER_AUTH_SECRET = stored.secret;
  console.log(
    stored.created
      ? '[auth] no BETTER_AUTH_SECRET set: generated one and stored it in the database'
      : '[auth] using the session secret stored in the database (BETTER_AUTH_SECRET is not set)',
  );
}

// Who may hold an account here: ALLOWED_EMAILS / DISABLE_SIGNUP. Both default
// to off, which leaves registration open — fine on a LAN, not on the internet.
const registration = registrationPolicyFromEnv();
// The provider may be a pairing, which lives in the database — migrations
// have run by now (`npm start` runs them first).
const authHost = await createAuthHost(db, {
  disableSignUp: registration.disableSignUp,
  allowedEmails: registration.allowedEmails,
});
const oidc = authHost.oidc();
if (oidc) {
  // The redirect URI is the one thing an operator has to copy into the provider, exactly.
  console.log(
    `[auth] sign-in with ${oidc.name} (${oidc.issuer}); redirect URI ${oidcRedirectUri()}`,
  );
}
if (registration.allowedEmails.length > 0) {
  console.log(`[auth] accounts limited to ${registration.allowedEmails.join(', ')}`);
}
if (registration.disableSignUp) console.log('[auth] sign-ups are closed');
if (registration.allowedEmails.length === 0 && !registration.disableSignUp) {
  console.warn(
    '[auth] registration is open: anyone who can reach this server can create an account. ' +
      'Set ALLOWED_EMAILS or DISABLE_SIGNUP if it is internet-reachable.',
  );
}

// Fold closed activities into the summaries table (once now, then periodic).
startRollupTimer(db);
// Rebuild devices whose uploads brought pings older than ones already folded.
startReplayTimer(db);

// A brand-new server prints a code that makes the first account, so setting
// one up needs no email (setup-code.ts).
const setupCode = (await hasUsers(db)) ? undefined : new SetupCode();
if (setupCode?.value) console.log(setupCodeBanner(setupCode.value, `${appUrl()}/`));

const gateway = createAuthGateway(authHost, db, {
  exposeMagicLinkToken: unsafeLocalNetwork,
  registration,
  setupCode,
});

// Built once and shared: /graphql and /mcp are the same API over two
// transports, and the permissions live in the schema, so one instance is what
// keeps that true rather than merely intended.
const schema = createSchema(db, gateway);
const yoga = createApp(db, authHost, gateway, schema);
const mcp = createMcpHandler(schema, createContextFactory(db, authHost));
const sso = createSsoHandler(authHost, { allowedEmails: registration.allowedEmails });

// WEB_DIST points at the built dashboard (set in the container image); the
// server then serves it on every non-/graphql path, so one origin hosts both
// and the SPA's relative /graphql calls need no proxy. Unset in dev, where
// vite serves the dashboard itself.
const webDist = process.env.WEB_DIST;
const serveStatic = webDist ? createStaticHandler(webDist) : null;
if (webDist) console.log(`serving web dashboard from ${webDist}`);

const server = createServer((req, res) => {
  const path = (req.url ?? '/').split('?')[0];
  // Before the static handler: its SPA fallback would answer /healthz with
  // index.html and a cheerful 200 while the database was down.
  if (path === '/healthz') {
    void checkHealth(db).then((health) => {
      res.writeHead(health.ok ? 200 : 503, { 'content-type': 'application/json' });
      res.end(JSON.stringify(health));
    });
    return;
  }
  // Before the static handler, for the same reason /healthz is: the SPA
  // fallback would otherwise answer an MCP client with index.html.
  if (path === '/mcp') {
    void mcp(req, res);
    return;
  }
  // Before the static handler too: the browser legs of an OIDC sign-in.
  if (sso(req, res)) return;
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
  console.log(
    `eunomia server ${VERSION} listening on http://${host}:${port}${yoga.graphqlEndpoint}`,
  );
  console.log(`mcp tools (read-only) on http://${host}:${port}/mcp`);
});
