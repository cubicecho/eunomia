// Signing an agent in through the server's OIDC provider with the device flow
// (RFC 8628), the way the other cubicecho apps' device clients do (the Home
// Assistant integrations' oidc.py). The agent asks the provider for a code,
// shows the person a link to approve it, and polls until they do. What comes
// back is an access token whose audience is eunomia's API (an RFC 8707
// resource indicator), which eunomia accepts as that person, plus a refresh
// token that keeps it fresh (credential.ts).
//
// Where to go comes from eunomia itself:
// - `/.well-known/oauth-protected-resource` (RFC 9728) names the provider
//   (`authorization_servers`) and eunomia's audience (`resource`).
// - `ssoSetup.deviceClientId` names the public client to use.
//
// Pure fetch, with the form bodies encoded by hand: nothing here may touch
// node, electron or react-native APIs, and React Native's URLSearchParams is
// not one to lean on.

import { createSdk } from './api.ts';

/** The device code grant (RFC 8628). */
export const DEVICE_CODE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code';
/** Who the person is, and a refresh token that outlives this run. */
export const DEVICE_SCOPE = 'openid email offline_access';
/** Refresh this long before the access token expires. */
export const REFRESH_MARGIN_MS = 60_000;
/** RFC 8628 §3.5: add five seconds to the interval on slow_down. */
const SLOW_DOWN_STEP_SECONDS = 5;
/** What the provider is assumed to say when it leaves a lifetime or interval out. */
const DEFAULT_EXPIRES_IN_SECONDS = 600;
const DEFAULT_INTERVAL_SECONDS = 5;
const DEFAULT_TOKEN_SECONDS = 300;

/** How a device sign-in ended without a token. `code` is the provider's error, or ours. */
export class DeviceFlowError extends Error {
  readonly code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = 'DeviceFlowError';
    this.code = code;
  }
}

/** What the server says about signing an agent in through its provider. */
export interface DeviceSignIn {
  /** What the provider is called, for "Sign in with …". */
  providerName: string;
  issuer: string;
  /** eunomia's API audience, the `resource` every token is asked for. */
  audience: string;
  clientId: string;
}

/** The two provider endpoints the flow uses. */
export interface ProviderEndpoints {
  issuer: string;
  deviceAuthorizationEndpoint: string;
  tokenEndpoint: string;
}

/** What the person is shown while the agent waits. */
export interface DeviceAuthorization {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  /** The link with the code already in it, when the provider gives one. */
  verificationUriComplete: string | null;
  expiresInSeconds: number;
  intervalSeconds: number;
}

/** A provider token set, as kept. */
export interface TokenSet {
  accessToken: string;
  refreshToken: string | null;
  /** Epoch ms. */
  expiresAt: number;
}

type Fetch = typeof fetch;

const noTrailingSlash = (url: string): string => url.replace(/\/+$/, '');

const text = (value: unknown): string | null =>
  typeof value === 'string' && value !== '' ? value : null;

/** `application/x-www-form-urlencoded`, by hand. */
function form(fields: Record<string, string>): string {
  return Object.entries(fields)
    .map(([name, value]) => `${encodeURIComponent(name)}=${encodeURIComponent(value)}`)
    .join('&');
}

async function json(
  fetchImpl: Fetch,
  url: string,
  init: RequestInit = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  let response: Response;
  try {
    response = await fetchImpl(url, {
      ...init,
      headers: { accept: 'application/json', ...init.headers },
    });
  } catch (error) {
    throw new DeviceFlowError(
      `Could not reach ${new URL(url).origin}: ${error instanceof Error ? error.message : String(error)}`,
      'unreachable',
    );
  }
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // An empty or non-JSON body reads as {}.
  }
  return {
    status: response.status,
    body: body && typeof body === 'object' ? (body as Record<string, unknown>) : {},
  };
}

const post = (fetchImpl: Fetch, url: string, fields: Record<string, string>) =>
  json(fetchImpl, url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: form(fields),
  });

const describe = (body: Record<string, unknown>, status: number): string =>
  text(body.error_description) ?? text(body.error) ?? `HTTP ${status}`;

/**
 * Whether the server lets agents sign in through its provider, and with what.
 * Null when it doesn't: no provider, a provider without the device flow (or
 * one whose admin hasn't turned it on yet), or a server too old to say. The
 * agent signs in with a link instead.
 */
export async function fetchDeviceSignIn(
  serverUrl: string,
  fetchImpl: Fetch = fetch,
): Promise<DeviceSignIn | null> {
  const { ssoSetup } = await createSdk(serverUrl).SsoSetup();
  if (!ssoSetup.deviceClientId || !ssoSetup.name) return null;
  const { status, body } = await json(
    fetchImpl,
    `${noTrailingSlash(serverUrl)}/.well-known/oauth-protected-resource`,
  );
  const issuer = Array.isArray(body.authorization_servers)
    ? text(body.authorization_servers[0])
    : null;
  const audience = text(body.resource);
  if (status !== 200 || !issuer || !audience) return null;
  return {
    providerName: ssoSetup.name,
    issuer: noTrailingSlash(issuer),
    audience,
    clientId: ssoSetup.deviceClientId,
  };
}

/** Reads the provider's discovery document, checking it is the issuer's own and offers the device flow. */
export async function discoverProvider(
  issuer: string,
  fetchImpl: Fetch = fetch,
): Promise<ProviderEndpoints> {
  const expected = noTrailingSlash(issuer);
  const { status, body } = await json(fetchImpl, `${expected}/.well-known/openid-configuration`);
  if (status !== 200 || noTrailingSlash(text(body.issuer) ?? '') !== expected) {
    throw new DeviceFlowError(`${expected} is not an OpenID Connect provider`, 'not_a_provider');
  }
  const device = text(body.device_authorization_endpoint);
  const token = text(body.token_endpoint);
  if (!device || !token) {
    throw new DeviceFlowError(`${expected} does not offer device sign-in`, 'no_device_flow');
  }
  return { issuer: expected, deviceAuthorizationEndpoint: device, tokenEndpoint: token };
}

/** Asks the provider for a code to show the person. */
export async function startDeviceAuthorization(
  endpoints: ProviderEndpoints,
  clientId: string,
  audience: string,
  fetchImpl: Fetch = fetch,
): Promise<DeviceAuthorization> {
  const { status, body } = await post(fetchImpl, endpoints.deviceAuthorizationEndpoint, {
    client_id: clientId,
    scope: DEVICE_SCOPE,
    resource: audience,
  });
  const deviceCode = text(body.device_code);
  const userCode = text(body.user_code);
  const verificationUri = text(body.verification_uri);
  if (status !== 200 || !deviceCode || !userCode || !verificationUri) {
    throw new DeviceFlowError(
      `The provider refused to start a sign-in: ${describe(body, status)}`,
      text(body.error) ?? 'refused',
    );
  }
  return {
    deviceCode,
    userCode,
    verificationUri,
    verificationUriComplete: text(body.verification_uri_complete),
    expiresInSeconds: Number(body.expires_in) || DEFAULT_EXPIRES_IN_SECONDS,
    intervalSeconds: Number(body.interval) || DEFAULT_INTERVAL_SECONDS,
  };
}

function tokensFrom(
  body: Record<string, unknown>,
  now: number,
  keep: string | null = null,
): TokenSet {
  return {
    accessToken: text(body.access_token) ?? '',
    // A refresh that does not rotate the token leaves it out.
    refreshToken: text(body.refresh_token) ?? keep,
    expiresAt: now + (Number(body.expires_in) || DEFAULT_TOKEN_SECONDS) * 1000,
  };
}

export interface PollOptions {
  fetch?: Fetch;
  /** Waits between polls; injectable for tests. */
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  /** Stops polling: the person cancelled. */
  signal?: AbortSignal;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Polls the token endpoint until the code is approved, denied, expired or cancelled. */
export async function pollDeviceToken(
  endpoints: ProviderEndpoints,
  clientId: string,
  device: DeviceAuthorization,
  options: PollOptions = {},
): Promise<TokenSet> {
  const fetchImpl = options.fetch ?? fetch;
  const sleep = options.sleep ?? defaultSleep;
  const now = options.now ?? Date.now;
  let interval = device.intervalSeconds;
  const deadline = now() + device.expiresInSeconds * 1000;
  for (;;) {
    await sleep(interval * 1000);
    if (options.signal?.aborted) throw new DeviceFlowError('Sign-in cancelled', 'cancelled');
    const { status, body } = await post(fetchImpl, endpoints.tokenEndpoint, {
      grant_type: DEVICE_CODE_GRANT,
      device_code: device.deviceCode,
      client_id: clientId,
    });
    if (status === 200 && text(body.access_token)) return tokensFrom(body, now());
    const error = text(body.error);
    if (error === 'slow_down') interval += SLOW_DOWN_STEP_SECONDS;
    else if (error === 'access_denied') {
      throw new DeviceFlowError('The sign-in was denied at the provider.', error);
    } else if (error === 'expired_token') {
      throw new DeviceFlowError('The sign-in code expired. Start again.', error);
    } else if (error !== 'authorization_pending') {
      throw new DeviceFlowError(
        `The provider refused the sign-in: ${describe(body, status)}`,
        error ?? 'refused',
      );
    }
    if (now() >= deadline) {
      throw new DeviceFlowError('The sign-in code expired. Start again.', 'expired_token');
    }
  }
}

/**
 * Trades the refresh token for a fresh access token for eunomia. A refusal
 * (`invalid_grant`: revoked or expired at the provider) is a DeviceFlowError
 * with code `signed_out`; a provider that is down is `unreachable`.
 */
export async function refreshTokens(
  tokenEndpoint: string,
  clientId: string,
  refreshToken: string,
  audience: string,
  fetchImpl: Fetch = fetch,
  now: () => number = Date.now,
): Promise<TokenSet> {
  const { status, body } = await post(fetchImpl, tokenEndpoint, {
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: clientId,
    resource: audience,
  });
  if (status === 200 && text(body.access_token)) return tokensFrom(body, now(), refreshToken);
  if (status >= 500) {
    throw new DeviceFlowError(`The provider answered ${status} to a refresh`, 'unreachable');
  }
  throw new DeviceFlowError(
    `The provider refused the refresh: ${describe(body, status)}`,
    'signed_out',
  );
}
