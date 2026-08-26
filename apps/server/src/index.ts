import { createServer } from 'node:http';
import { startRollupTimer } from './activity/rollup.ts';
import { createApp } from './app.ts';
import { createAuth, createAuthGateway } from './auth.ts';
import { createDb } from './db/client.ts';
import { SECRET_HELP, secretProblem, secretWarning } from './env.ts';
import { registrationPolicyFromEnv } from './registration.ts';
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
// for months before anyone notices.
const secret = process.env.BETTER_AUTH_SECRET;
const problem = secretProblem(secret);
if (problem && !unsafeLocalNetwork) {
  console.error(`[auth] refusing to start: ${problem}.\n${SECRET_HELP}`);
  process.exit(1);
}
if (problem) console.warn(`[auth] ${problem} (allowed by UNSAFE_LOCAL_NETWORK)`);
const warning = secretWarning(secret);
if (warning) console.warn(`[auth] ${warning}`);

const db = createDb();

// Who may hold an account here: ALLOWED_EMAILS / DISABLE_SIGNUP. Both default
// to off, which leaves registration open — fine on a LAN, not on the internet.
const registration = registrationPolicyFromEnv();
const auth = createAuth(db, { disableSignUp: registration.disableSignUp });
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

const yoga = createApp(
  db,
  auth,
  createAuthGateway(auth, db, { exposeMagicLinkToken: unsafeLocalNetwork, registration }),
);

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
