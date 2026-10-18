import { createHash, randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { base64Url, type SsoCredential, ssoStartUrl, ssoTokenFrom } from '@eunomia/agent';

// Signing the desktop agent in through the server's OIDC provider. The sign-in
// runs in the system browser, where the person's provider session (and
// password manager) already is, rather than in a window of ours they'd have to
// trust with a password. The answer comes back to a port this process opens on
// 127.0.0.1 for just this sign-in (RFC 8252's loopback redirect), and is bound
// to a verifier only this process holds (see packages/agent/src/sso.ts).

/** Long enough to sign in at the provider, short enough not to leave a port open all day. */
const TIMEOUT_MS = 5 * 60_000;

const PAGE = (message: string) =>
  `<!doctype html><meta charset="utf-8"><title>eunomia</title>` +
  `<body style="font-family:system-ui;max-width:28rem;margin:4rem auto;padding:0 1rem">` +
  `<h1 style="font-size:1.25rem">${message}</h1><p>You can close this tab and go back to eunomia.</p>`;

/** The sign-in in flight, so starting another cancels it rather than leaving two ports open. */
let inFlight: { server: Server; cancel(): void } | null = null;

/**
 * Opens the server's sign-in page in the browser and waits for its answer.
 * `openExternal` is Electron's shell.openExternal, passed in so this stays
 * testable without Electron.
 */
export async function signInWithBrowser(
  signInUrl: string,
  openExternal: (url: string) => Promise<void>,
): Promise<SsoCredential> {
  const target = new URL(signInUrl);
  // The one URL this process will hand to the OS to open: never file:, never
  // a custom scheme some other app registered.
  if (target.protocol !== 'https:' && target.protocol !== 'http:') {
    throw new Error('The server gave a sign-in address that is not a web page.');
  }
  inFlight?.cancel();

  const codeVerifier = base64Url(randomBytes(32));
  const challenge = createHash('sha256').update(codeVerifier).digest('base64url');

  let settle!: { resolve(url: string): void; reject(error: Error): void };
  const returned = new Promise<string>((resolve, reject) => {
    settle = { resolve, reject };
  });
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    // Browsers ask for a favicon; only the sign-in's own path answers it.
    if (url.pathname !== '/sso') {
      res.writeHead(404);
      res.end();
      return;
    }
    const failed = url.searchParams.has('error');
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(PAGE(failed ? 'Signing in did not work.' : 'Signed in.'));
    settle.resolve(url.toString());
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  const timer = setTimeout(
    () => settle.reject(new Error('Timed out waiting for the browser sign-in. Try again.')),
    TIMEOUT_MS,
  );
  const flight = {
    server,
    cancel: () => settle.reject(new Error('Sign-in cancelled.')),
  };
  inFlight = flight;

  try {
    await openExternal(ssoStartUrl(signInUrl, `http://127.0.0.1:${port}/sso`, challenge));
    return { token: ssoTokenFrom(await returned), codeVerifier };
  } finally {
    clearTimeout(timer);
    server.closeAllConnections();
    server.close();
    if (inFlight === flight) inFlight = null;
  }
}
