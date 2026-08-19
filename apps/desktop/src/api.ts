import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Server calls shared by the two provisioning flows (terminal --provision and
// the onboarding window). Nothing here may touch stdin or electron — the tray
// path imports this module unconditionally.

export interface AgentConfig {
  serverUrl: string;
  apiKey: string;
}

interface GraphQLResponse<T> {
  data?: T;
  errors?: { message: string }[];
}

export async function gql<T>(
  serverUrl: string,
  query: string,
  variables: Record<string, unknown>,
  token?: string,
): Promise<T> {
  const response = await fetch(new URL('/graphql', serverUrl), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} from ${serverUrl}`);
  const body = (await response.json()) as GraphQLResponse<T>;
  if (body.errors?.length) throw new Error(body.errors[0]?.message ?? 'GraphQL error');
  if (!body.data) throw new Error('empty response');
  return body.data;
}

const PLATFORMS: Record<string, string> = {
  win32: 'windows',
  darwin: 'macos',
  linux: 'linux',
};

export function platformName(): string {
  return PLATFORMS[process.platform] ?? 'linux';
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
  const { requestMagicLink: result } = await gql<{ requestMagicLink: { token: string | null } }>(
    serverUrl,
    'mutation ($email: String!) { requestMagicLink(email: $email) { token } }',
    { email },
  );
  return result.token;
}

/** Trades a magic token (or pasted link) for a bearer session token. */
export async function verifyMagicLink(serverUrl: string, tokenOrLink: string): Promise<string> {
  const { verifyMagicLink: result } = await gql<{ verifyMagicLink: { token: string } }>(
    serverUrl,
    'mutation ($token: String!) { verifyMagicLink(token: $token) { token } }',
    { token: extractMagicToken(tokenOrLink.trim()) },
  );
  return result.token;
}

export async function registerDevice(
  serverUrl: string,
  sessionToken: string,
  name: string,
): Promise<{ deviceId: string; apiKey: string }> {
  const { registerDevice: result } = await gql<{
    registerDevice: { device: { id: string }; apiKey: string };
  }>(
    serverUrl,
    'mutation ($name: String!, $platform: String!) { registerDevice(name: $name, platform: $platform) { device { id } apiKey } }',
    { name, platform: platformName() },
    sessionToken,
  );
  return { deviceId: result.device.id, apiKey: result.apiKey };
}

/** Best-effort: the agent runs on the API key, the session is disposable. */
export async function signOut(serverUrl: string, sessionToken: string): Promise<void> {
  await gql(serverUrl, 'mutation { signOut }', {}, sessionToken).catch(() => {});
}

export function writeAgentConfig(dataDir: string, config: AgentConfig): string {
  const configPath = join(dataDir, 'config.json');
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
  return configPath;
}
