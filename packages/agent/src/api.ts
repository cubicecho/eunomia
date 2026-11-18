// Server access shared by every agent. Response/variable types all come from
// the generated SDK (@eunomia/gql/agent, build output — see packages/gql); this
// file only supplies the fetch transport and small conveniences.
// Pure fetch — nothing here may touch node, electron, or react-native APIs.

import { getSdk, type Requester, type Sdk } from '@eunomia/gql/agent';
import type { AgentCredential, TokenSource } from './credential.ts';
import type { PrivacyConfig } from './privacy.ts';

export interface AgentConfig extends PrivacyConfig {
  serverUrl: string;
  /** The device this install registered as; every upload names it. */
  deviceId: string;
  /** Who the agent signs in as (credential.ts). */
  credential: AgentCredential;
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

/** The server's code for a bearer it does not accept. */
export const UNAUTHENTICATED = 'UNAUTHENTICATED';

/**
 * Runs one call with the token source's bearer, and once more with a
 * refreshed one if the server refused it: a provider token can be refused a
 * little before the expiry it carries (a revoked grant, a clock off).
 */
export async function withBearer<R>(
  serverUrl: string,
  tokens: TokenSource,
  call: (sdk: Sdk) => Promise<R>,
): Promise<R> {
  try {
    return await call(createSdk(serverUrl, await tokens.bearer()));
  } catch (error) {
    const refused = error instanceof GraphQLRequestError && error.code === UNAUTHENTICATED;
    if (!refused || !(await tokens.recover())) throw error;
    return call(createSdk(serverUrl, await tokens.bearer()));
  }
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
  bearer: string,
  name: string,
  platform: string,
): Promise<string> {
  const { registerDevice: device } = await createSdk(serverUrl, bearer).RegisterDevice({
    name,
    platform,
  });
  return device.id;
}

export async function renameDevice(
  serverUrl: string,
  bearer: string,
  deviceId: string,
  name: string,
): Promise<void> {
  await createSdk(serverUrl, bearer).RenameDevice({ id: deviceId, name });
}

/** Best-effort: signs a session out, so a link-signed-in agent leaves nothing behind. */
export async function signOut(serverUrl: string, sessionToken: string): Promise<void> {
  await createSdk(serverUrl, sessionToken)
    .SignOut({})
    .catch(() => {});
}
