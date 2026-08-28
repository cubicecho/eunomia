// Server access shared by every agent. Response/variable types all come from
// the generated SDK (@eunomia/gql/agent, build output — see packages/gql); this
// file only supplies the fetch transport and small conveniences.
// Pure fetch — nothing here may touch node, electron, or react-native APIs.

import { getSdk, type Requester, type Sdk } from '@eunomia/gql/agent';
import type { PrivacyConfig } from './privacy.ts';

export interface AgentConfig extends PrivacyConfig {
  serverUrl: string;
  apiKey: string;
  /** Seconds between server syncs. Defaults to DEFAULT_SYNC_INTERVAL_SECONDS (see ping.ts). */
  syncIntervalSeconds?: number;
}

export interface GraphQLTransportError {
  message: string;
  extensions?: { code?: string };
}

/**
 * A GraphQL error the server answered with, carrying its `extensions.code`.
 *
 * The code is the difference between "retry this forever" and "this will never
 * be accepted" — the uploader drops a batch only for a code it recognizes as
 * permanent, so throwing a bare Error here would mean every rejection looked
 * retryable and one malformed ping could wedge the outbox.
 */
export class GraphQLRequestError extends Error {
  readonly code: string | null;
  constructor(message: string, code?: string | null) {
    super(message);
    this.name = 'GraphQLRequestError';
    this.code = code ?? null;
  }
}

function requesterWithHeaders(serverUrl: string, authHeaders: Record<string, string>): Requester {
  return async <R, V>(doc: string, vars?: V): Promise<R> => {
    const response = await fetch(new URL('/graphql', serverUrl), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...authHeaders,
      },
      // `doc` may be a TypedDocumentString (a String subclass) — normalize.
      body: JSON.stringify({ query: String(doc), variables: vars }),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status} from ${serverUrl}`);
    const body = (await response.json()) as { data?: R; errors?: GraphQLTransportError[] };
    const failure = body.errors?.[0];
    if (failure) throw new GraphQLRequestError(failure.message, failure.extensions?.code);
    if (body.data === undefined || body.data === null) throw new Error('empty response');
    return body.data;
  };
}

/** Executes generated document strings against `/graphql` on the server. */
export function createRequester(serverUrl: string, token?: string): Requester {
  return requesterWithHeaders(serverUrl, token ? { authorization: `Bearer ${token}` } : {});
}

/** Typed SDK over every operation in src/operations.graphql. */
export function createSdk(serverUrl: string, token?: string): Sdk {
  return getSdk(createRequester(serverUrl, token));
}

/**
 * The SDK an agent runs on: authenticated by its device API key, which also
 * tells the server which device every ping belongs to.
 */
export function createDeviceSdk(config: AgentConfig): Sdk {
  return getSdk(requesterWithHeaders(config.serverUrl, { 'x-api-key': config.apiKey }));
}

// Accepts either the full emailed link (…/?token=xyz) or the bare token.
export function extractMagicToken(input: string): string {
  try {
    const token = new URL(input).searchParams.get('token');
    if (token) return token;
  } catch {
    // not a URL — treat as a raw token
  }
  return input;
}

/** Null token means the server emailed a link instead of handing it back. */
export async function requestMagicLink(serverUrl: string, email: string): Promise<string | null> {
  const { requestMagicLink: result } = await createSdk(serverUrl).RequestMagicLink({ email });
  return result.token ?? null;
}

/** Trades a magic token (or pasted link) for a bearer session token. */
export async function verifyMagicLink(serverUrl: string, tokenOrLink: string): Promise<string> {
  const { verifyMagicLink: result } = await createSdk(serverUrl).VerifyMagicLink({
    token: extractMagicToken(tokenOrLink.trim()),
  });
  return result.token;
}

export async function registerDevice(
  serverUrl: string,
  sessionToken: string,
  name: string,
  platform: string,
): Promise<{ deviceId: string; apiKey: string }> {
  const { registerDevice: result } = await createSdk(serverUrl, sessionToken).RegisterDevice({
    name,
    platform,
  });
  return { deviceId: result.device.id, apiKey: result.apiKey };
}

/**
 * Issues a fresh API key for a device that already exists, revoking the old
 * one. How an agent re-keys itself without registering a second device — which
 * would strand its history on the first one.
 */
export async function rotateDeviceKey(
  serverUrl: string,
  sessionToken: string,
  deviceId: string,
): Promise<{ deviceId: string; apiKey: string }> {
  const { rotateDeviceKey: result } = await createSdk(serverUrl, sessionToken).RotateDeviceKey({
    id: deviceId,
  });
  return { deviceId: result.device.id, apiKey: result.apiKey };
}

export async function renameDevice(
  serverUrl: string,
  sessionToken: string,
  deviceId: string,
  name: string,
): Promise<void> {
  await createSdk(serverUrl, sessionToken).RenameDevice({ id: deviceId, name });
}

/**
 * Trades the device API key for a short-lived dashboard session token — how
 * the desktop opens the web dashboard without a second sign-in. The key never
 * leaves this call; only the expiring session token reaches the web view.
 */
export async function sessionFromDeviceKey(serverUrl: string, apiKey: string): Promise<string> {
  const sdk = getSdk(requesterWithHeaders(serverUrl, { 'x-api-key': apiKey }));
  const { sessionFromDeviceKey: result } = await sdk.SessionFromDeviceKey({});
  return result.token;
}

/** Best-effort: the agent runs on the API key, the session is disposable. */
export async function signOut(serverUrl: string, sessionToken: string): Promise<void> {
  await createSdk(serverUrl, sessionToken)
    .SignOut({})
    .catch(() => {});
}
