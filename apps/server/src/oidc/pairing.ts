import type { Db } from '../db/client.ts';
import { DEFAULT_OIDC_NAME, oidcRedirectUri, serverUrl } from './config.ts';
import { DEVICE_CODE_GRANT, forgetDeviceClientCheck } from './device-client.ts';
import { clearPairedOidc, type PairedOidc, readPairedOidc, savePairedOidc } from './settings.ts';

// Pairing with an OIDC provider by pasting one URL, instead of copying a client
// id and secret into the environment. The provider (heautou, or any other that
// does OAuth 2.0 Dynamic Client Registration) hands its admin a setup URL:
//
//   <issuer>#setup=<initial access token>&name=<what to call it>
//
// eunomia reads the issuer's discovery document, registers itself at its
// registration endpoint with the token (RFC 7591), and keeps the client it gets
// back. When the provider offers the device flow (RFC 8628), eunomia registers
// a second, public client with the same token, for the agents (desktop,
// Android) to sign in with; a provider that allows the token once refuses it,
// and pairing goes on without one. The provider may hold that client's device
// flow back until its admin turns it on (device-client.ts checks). Unpairing
// deletes both clients at the provider (RFC 7592).
//
// eunomia also registers its own address as `client_uri`. Under it, eunomia
// serves its protected resource metadata (protected-resource.ts), where heautou
// finds eunomia's API to offer its admin.
//
// The token is a credential: it is sent once, to the endpoint the issuer names,
// and never logged or stored.

/** Why pairing failed, for the dashboard to say what to do next. Sent as `extensions.reason`. */
export const PairingFailure = {
  /** The text is not a setup URL. */
  BadUrl: 'BAD_URL',
  /** Nothing at the URL answers as an OIDC provider, or it names a different issuer. */
  NotAProvider: 'NOT_A_PROVIDER',
  /** The provider has no registration endpoint. */
  NoRegistration: 'NO_REGISTRATION',
  /** The setup URL has expired, was used already, or was cancelled. */
  Expired: 'EXPIRED',
  /** The provider would not register eunomia as described. */
  Refused: 'REFUSED',
  /** The provider is turning requests away for now. */
  RateLimited: 'RATE_LIMITED',
} as const;
export type PairingFailure = (typeof PairingFailure)[keyof typeof PairingFailure];

export class PairingError extends Error {
  constructor(
    readonly reason: PairingFailure,
    message: string,
  ) {
    super(message);
    this.name = 'PairingError';
  }
}

export interface SetupUrl {
  issuer: string;
  token: string;
  name: string;
}

/** What eunomia asks the provider to call it. */
const CLIENT_NAME = 'eunomia';
/** What eunomia asks the provider to call the agents' device client. */
const DEVICE_CLIENT_NAME = 'eunomia agents';
/** The grant a device client keeps its token fresh with. */
const REFRESH_TOKEN_GRANT = 'refresh_token';

/** How long pairing waits on the provider before calling it unreachable. */
const TIMEOUT_MS = 10_000;

/** Takes a setup URL apart, or throws BAD_URL. */
export function parseSetupUrl(text: string): SetupUrl {
  let url: URL;
  try {
    url = new URL(text.trim());
  } catch {
    throw new PairingError(
      PairingFailure.BadUrl,
      'That is not a URL. Paste the setup URL your provider gave you.',
    );
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new PairingError(PairingFailure.BadUrl, 'A setup URL starts with https://.');
  }
  const params = new URLSearchParams(url.hash.slice(1));
  const token = params.get('setup');
  if (!token) {
    throw new PairingError(
      PairingFailure.BadUrl,
      'That URL has no setup token. Copy the whole setup URL from your provider.',
    );
  }
  url.hash = '';
  url.search = '';
  return {
    issuer: url.toString().replace(/\/+$/, ''),
    token,
    name: params.get('name')?.trim() || DEFAULT_OIDC_NAME,
  };
}

/** Fetches with a timeout, calling any network failure the provider being unreachable. */
async function call(url: string, init: RequestInit = {}): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    throw new PairingError(
      PairingFailure.NotAProvider,
      `Could not reach ${new URL(url).origin}. Check the setup URL.`,
    );
  }
}

/** The body of a JSON response, or an empty object when it has none. */
async function json(response: Response): Promise<Record<string, unknown>> {
  try {
    const body: unknown = await response.json();
    return body !== null && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

const text = (value: unknown): string | null =>
  typeof value === 'string' && value !== '' ? value : null;

/** What pairing needs from a provider's discovery document. */
interface Discovery {
  registrationEndpoint: string;
  /** Whether the provider offers the device flow, and so whether to register a device client. */
  hasDeviceFlow: boolean;
}

/** The issuer's registration endpoint, once its discovery document has been checked as the issuer's own. */
async function discover(issuer: string): Promise<Discovery> {
  const response = await call(`${issuer}/.well-known/openid-configuration`, {
    headers: { accept: 'application/json' },
  });
  const doc = response.ok ? await json(response) : {};
  // A document naming another issuer would have the token sent wherever it says.
  if (text(doc.issuer)?.replace(/\/+$/, '') !== issuer) {
    throw new PairingError(
      PairingFailure.NotAProvider,
      `${issuer} is not an OpenID Connect provider. Check the setup URL.`,
    );
  }
  const endpoint = text(doc.registration_endpoint);
  if (endpoint === null) {
    throw new PairingError(
      PairingFailure.NoRegistration,
      'This provider does not support pairing. Set OIDC_ISSUER and OIDC_CLIENT_ID in the environment instead.',
    );
  }
  // A provider that lists no grant types is taken at its device endpoint's word.
  const grants = Array.isArray(doc.grant_types_supported) ? doc.grant_types_supported : null;
  const hasDeviceFlow =
    text(doc.device_authorization_endpoint) !== null &&
    (grants === null || grants.includes(DEVICE_CODE_GRANT));
  return { registrationEndpoint: endpoint, hasDeviceFlow };
}

function clientMetadata() {
  return {
    client_name: CLIENT_NAME,
    client_uri: serverUrl(),
    redirect_uris: [oidcRedirectUri()],
    token_endpoint_auth_method: 'client_secret_basic',
    grant_types: ['authorization_code'],
    response_types: ['code'],
  };
}

/** What eunomia asks its device client to be registered as: public, no redirect, the device flow. */
function deviceClientMetadata() {
  return {
    client_name: DEVICE_CLIENT_NAME,
    client_uri: serverUrl(),
    redirect_uris: [],
    token_endpoint_auth_method: 'none',
    grant_types: [DEVICE_CODE_GRANT, REFRESH_TOKEN_GRANT],
    response_types: [],
  };
}

/** The device client a provider registered. */
interface DeviceRegistration {
  clientId: string;
  registrationAccessToken: string | null;
  registrationClientUri: string | null;
}

/**
 * Registers the device client with the setup URL's token, after eunomia's own
 * client. Never fails the pairing: a provider that allows the token once, or
 * won't hold a device client, leaves the agents to OIDC_DEVICE_CLIENT_ID or a
 * sign-in link. Returns null when the provider registered none.
 */
async function registerDeviceClient(
  endpoint: string,
  token: string,
): Promise<DeviceRegistration | null> {
  try {
    const response = await call(endpoint, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify(deviceClientMetadata()),
    });
    if (!response.ok) {
      console.warn(
        `[auth] the OIDC provider answered ${response.status} to registering a device client`,
      );
      return null;
    }
    const body = await json(response);
    const clientId = text(body.client_id);
    if (clientId === null) return null;
    return {
      clientId,
      registrationAccessToken: text(body.registration_access_token),
      registrationClientUri: text(body.registration_client_uri),
    };
  } catch {
    console.warn('[auth] could not register a device client with the OIDC provider');
    return null;
  }
}

/** Turns a failed registration call into what to tell the admin. */
async function refusal(response: Response): Promise<PairingError> {
  const body = await json(response);
  const description = text(body.error_description) ?? text(body.error);
  if (response.status === 401 || body.error === 'invalid_token') {
    return new PairingError(
      PairingFailure.Expired,
      'This setup URL has expired, was used already, or was cancelled. Ask your provider for a new one.',
    );
  }
  if (response.status === 429) {
    return new PairingError(
      PairingFailure.RateLimited,
      'The provider is turning requests away for now. Try again in a minute.',
    );
  }
  if (response.status === 400) {
    return new PairingError(
      PairingFailure.Refused,
      `The provider refused to register ${CLIENT_NAME}: ${description ?? 'no reason given'}.`,
    );
  }
  return new PairingError(
    PairingFailure.NotAProvider,
    `The provider answered ${response.status} when asked to register ${CLIENT_NAME}.`,
  );
}

/**
 * Registers eunomia with the provider a setup URL names, and keeps the client.
 * The caller rebuilds the auth instance (auth-host.ts) to use it. Throws a
 * PairingError saying why, when nothing was paired.
 */
export async function pair(db: Db, setupUrl: string): Promise<PairedOidc> {
  const setup = parseSetupUrl(setupUrl);
  const { registrationEndpoint: endpoint, hasDeviceFlow } = await discover(setup.issuer);
  const response = await call(endpoint, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${setup.token}`,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify(clientMetadata()),
  });
  if (!response.ok) throw await refusal(response);
  const body = await json(response);
  const clientId = text(body.client_id);
  if (clientId === null) {
    throw new PairingError(
      PairingFailure.NotAProvider,
      `The provider registered ${CLIENT_NAME} but sent back no client id.`,
    );
  }
  const device = hasDeviceFlow ? await registerDeviceClient(endpoint, setup.token) : null;
  const paired: PairedOidc = {
    issuer: setup.issuer,
    clientId,
    clientSecret: text(body.client_secret),
    // The provider may have registered another method than the one asked for; its answer is what counts.
    clientAuth:
      body.token_endpoint_auth_method === 'client_secret_post'
        ? 'client_secret_post'
        : 'client_secret_basic',
    name: setup.name,
    registrationAccessToken: text(body.registration_access_token),
    registrationClientUri: text(body.registration_client_uri),
    deviceClientId: device?.clientId ?? null,
    deviceRegistrationAccessToken: device?.registrationAccessToken ?? null,
    deviceRegistrationClientUri: device?.registrationClientUri ?? null,
  };
  await savePairedOidc(db, paired);
  forgetDeviceClientCheck();
  return paired;
}

/**
 * Deletes eunomia's clients at the provider and forgets the pairing. Returns
 * whether the provider confirmed eunomia's own client is gone. The pairing is
 * forgotten even when the provider can't be reached, so an admin is never stuck
 * with a provider they want gone; its own admin can remove the clients on
 * their side.
 */
export async function unpair(db: Db): Promise<boolean> {
  const paired = await readPairedOidc(db);
  if (!paired) return true;
  const removed = await deleteClient(paired.registrationClientUri, paired.registrationAccessToken);
  // The device client goes too; whether it did is the provider's admin's to tidy.
  await deleteClient(paired.deviceRegistrationClientUri, paired.deviceRegistrationAccessToken);
  await clearPairedOidc(db);
  forgetDeviceClientCheck();
  return removed;
}

/** Deletes a client at the provider (RFC 7592). Whether it confirmed it is gone; false with no way to ask. */
async function deleteClient(uri: string | null, token: string | null): Promise<boolean> {
  if (!uri || !token) return false;
  try {
    const response = await fetch(uri, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    // A 401 or a 404: the client is already gone, which is what was wanted.
    const removed = response.ok || response.status === 401 || response.status === 404;
    if (!removed) {
      console.warn(`[auth] OIDC provider answered ${response.status} to deleting a client`);
    }
    return removed;
  } catch (error) {
    console.warn('[auth] could not reach the OIDC provider to delete a client:', error);
    return false;
  }
}
