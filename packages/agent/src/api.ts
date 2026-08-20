// Server access shared by every agent. Response/variable types all come from
// the generated SDK (src/gql/sdk.ts — regenerate with `npm run codegen` at the
// root); this file only supplies the fetch transport and small conveniences.
// Pure fetch — nothing here may touch node, electron, or react-native APIs.

import { getSdk, type Requester, type Sdk } from './gql/sdk.ts';
import type { PrivacyConfig } from './privacy.ts';

export interface AgentConfig extends PrivacyConfig {
  serverUrl: string;
  apiKey: string;
  /** Seconds between server syncs. Defaults to DEFAULT_SYNC_INTERVAL_SECONDS (see ping.ts). */
  syncIntervalSeconds?: number;
}

export interface GraphQLTransportError {
  message: string;
}

/** Executes generated document strings against `/graphql` on the server. */
export function createRequester(serverUrl: string, token?: string): Requester {
  return async <R, V>(doc: string, vars?: V): Promise<R> => {
    const response = await fetch(new URL('/graphql', serverUrl), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      // `doc` may be a TypedDocumentString (a String subclass) — normalize.
      body: JSON.stringify({ query: String(doc), variables: vars }),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status} from ${serverUrl}`);
    const body = (await response.json()) as { data?: R; errors?: GraphQLTransportError[] };
    if (body.errors?.length) throw new Error(body.errors[0]?.message ?? 'GraphQL error');
    if (body.data === undefined || body.data === null) throw new Error('empty response');
    return body.data;
  };
}

/** Typed SDK over every operation in src/operations.graphql. */
export function createSdk(serverUrl: string, token?: string): Sdk {
  return getSdk(createRequester(serverUrl, token));
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

/** Best-effort: the agent runs on the API key, the session is disposable. */
export async function signOut(serverUrl: string, sessionToken: string): Promise<void> {
  await createSdk(serverUrl, sessionToken)
    .SignOut({})
    .catch(() => {});
}
