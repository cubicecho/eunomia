import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Auth } from '../auth.ts';
import type { AuthHost } from '../auth-host.ts';
import { emailAllowed } from '../registration.ts';
import {
  appUrl,
  OIDC_PROVIDER_ID,
  SSO_CALLBACK_PATH,
  SSO_START_PATH,
  serverUrl,
} from './config.ts';

// The two legs of an OIDC sign-in that can't be GraphQL, because the browser
// has to be sent somewhere: out to the provider, and back from it. Both are
// better-auth's own endpoints (`signInSocial` and `/callback/:id`); this file
// only carries them over HTTP and changes how the session reaches the
// dashboard.
//
// better-auth would end the callback by setting a session cookie. eunomia
// keeps its session as a bearer token instead, so the cookie is dropped and the
// browser lands on the dashboard as `/?sso=<one-time token>`, which the
// dashboard swaps for a session over GraphQL (verifyOneTimeToken).
//
// The agents never come through here: they run the provider's device flow and
// send its access token as their bearer (provider-tokens.ts).

/** What the dashboard is told, as `/?error=`, when something here went wrong before better-auth could say. */
export const SsoError = {
  SignInFailed: 'sign_in_failed',
  CallbackFailed: 'callback_failed',
  /** No provider: none was ever set, or it was disconnected after the page loaded. */
  Off: 'sso_off',
  /** The provider vouched for an address ALLOWED_EMAILS doesn't cover. */
  NotAllowed: 'not_allowed',
} as const;

export interface SsoHandlerOptions {
  /** ALLOWED_EMAILS: an existing account outside it is refused here, as signIn refuses it. */
  allowedEmails?: string[] | undefined;
}

/**
 * The start and callback routes. Returns a handler that answers a request it
 * owns and reports true, or leaves it alone and reports false. Always mounted,
 * since a provider can be paired while the server runs; with none, both send
 * the browser back to the dashboard with `sso_off`.
 */
export function createSsoHandler(host: AuthHost, options: SsoHandlerOptions = {}) {
  return (req: IncomingMessage, res: ServerResponse): boolean => {
    const path = (req.url ?? '/').split('?')[0];
    if (req.method !== 'GET' || (path !== SSO_START_PATH && path !== SSO_CALLBACK_PATH)) {
      return false;
    }
    if (host.oidc() === null) {
      redirect(res, failedUrl(SsoError.Off));
      return true;
    }
    if (path === SSO_START_PATH) {
      start(host.current(), req, res).catch((error: unknown) =>
        fail(res, SsoError.SignInFailed, error),
      );
      return true;
    }
    callback(host.current(), req, res, options).catch((error: unknown) =>
      fail(res, SsoError.CallbackFailed, error),
    );
    return true;
  };
}

function toHeaders(raw: IncomingMessage['headers']): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(raw)) {
    if (value === undefined) continue;
    for (const one of Array.isArray(value) ? value : [value]) headers.append(name, one);
  }
  return headers;
}

/**
 * Starts a sign-in. better-auth makes the state (with a signed cookie that ties
 * it to this browser), the PKCE verifier and the nonce, and says where the
 * provider's authorize page is.
 */
async function start(auth: Auth, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const { headers, response } = await auth.api.signInSocial({
    body: {
      provider: OIDC_PROVIDER_ID,
      callbackURL: `${appUrl()}/`,
      errorCallbackURL: `${appUrl()}/`,
      disableRedirect: true,
    },
    headers: toHeaders(req.headers),
    returnHeaders: true,
  });
  const url = response && 'url' in response ? response.url : undefined;
  if (!url) throw new Error('better-auth returned no authorize URL');
  appendCookies(res, headers?.getSetCookie() ?? []);
  redirect(res, url);
}

/**
 * The provider's redirect back. better-auth checks the state, swaps the code,
 * verifies the id token and opens a session; this then swaps the session
 * cookie it would have set for a one-time token on the dashboard's URL.
 */
async function callback(
  auth: Auth,
  req: IncomingMessage,
  res: ServerResponse,
  options: SsoHandlerOptions,
): Promise<void> {
  const request = new Request(new URL(req.url ?? '/', serverUrl()), {
    method: 'GET',
    headers: toHeaders(req.headers),
  });
  const response = await auth.handler(request);
  const ctx = await auth.$context;
  const sessionCookies = new Set([
    ctx.authCookies.sessionToken.name,
    ctx.authCookies.sessionData.name,
  ]);
  // The state cookie's expiry, and anything else that is not the session.
  appendCookies(
    res,
    response.headers
      .getSetCookie()
      .filter((cookie) => !sessionCookies.has(cookie.slice(0, cookie.indexOf('=')))),
  );

  const location = response.headers.get('location');
  if (!location) {
    fail(
      res,
      SsoError.CallbackFailed,
      new Error(`better-auth's callback answered ${response.status} with no redirect`),
    );
    return;
  }
  // The bearer plugin sets this whenever a session cookie is: the new session.
  const session = response.headers.get('set-auth-token');
  if (!session) {
    // A refusal: better-auth is sending the browser back with its error code.
    redirect(res, location);
    return;
  }
  const bearer = new Headers({ authorization: `Bearer ${session}` });

  // An account made before ALLOWED_EMAILS was narrowed is refused here, the
  // same as signIn refuses it. (New accounts outside it are never created —
  // see the user.create hook in auth.ts.)
  const opened = await auth.api.getSession({ headers: bearer });
  if (opened && !emailAllowed(opened.user.email, options.allowedEmails ?? [])) {
    await auth.api.signOut({ headers: bearer });
    redirect(res, failedUrl(SsoError.NotAllowed));
    return;
  }

  const { token } = await auth.api.generateOneTimeToken({ headers: bearer });
  redirect(res, withParam(new URL(location, appUrl()).toString(), 'sso', token));
}

function appendCookies(res: ServerResponse, cookies: string[]): void {
  if (cookies.length > 0) res.appendHeader('set-cookie', cookies);
}

function redirect(res: ServerResponse, location: string): void {
  res.writeHead(302, { location });
  res.end();
}

/** `url` with one query parameter set. */
function withParam(url: string, name: string, value: string): string {
  const next = new URL(url);
  next.searchParams.set(name, value);
  return next.toString();
}

/** Where a failed sign-in goes: the dashboard, which says so. */
function failedUrl(code: string): string {
  return withParam(`${appUrl()}/`, 'error', code);
}

/** Logs a failure and sends the browser back, saying signing in failed. */
function fail(res: ServerResponse, code: string, error: unknown): void {
  console.error(`[auth] OIDC ${code}:`, error);
  if (res.headersSent) return;
  redirect(res, failedUrl(code));
}
