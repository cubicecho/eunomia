import { writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';

// One-shot terminal flow (run with --provision): sign in via magic link,
// register this machine as a device, and write the userData config.json the
// tray agent uploads with. The session token is only held for the two calls
// and revoked at the end — the agent authenticates with the device API key.

interface GraphQLResponse<T> {
  data?: T;
  errors?: { message: string }[];
}

async function gql<T>(
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
  if (body.errors?.length) throw new Error(body.errors[0]!.message);
  if (!body.data) throw new Error('empty response');
  return body.data;
}

// One shared readline interface for the whole flow: a fresh interface per
// question would drop lines buffered on piped (non-tty) stdin. Hidden input
// mutes the echo, which only exists in terminal mode anyway.
let muted = false;
const promptOutput = new Writable({
  write(chunk: Buffer | string, _encoding, callback) {
    if (!muted) process.stdout.write(chunk);
    callback();
  },
});
const rl = createInterface({
  input: process.stdin,
  output: promptOutput,
  terminal: process.stdin.isTTY === true,
});

// Lines are buffered as they arrive: piped stdin can deliver several answers
// in one chunk, and readline drops `line` events nothing is waiting on.
const bufferedLines: string[] = [];
const lineWaiters: ((line: string) => void)[] = [];
rl.on('line', (line) => {
  const waiter = lineWaiters.shift();
  if (waiter) waiter(line);
  else bufferedLines.push(line);
});

function nextLine(): Promise<string> {
  const buffered = bufferedLines.shift();
  if (buffered !== undefined) return Promise.resolve(buffered);
  return new Promise((resolve) => lineWaiters.push(resolve));
}

async function prompt(question: string, { hidden = false, fallback = '' } = {}): Promise<string> {
  process.stdout.write(question);
  muted = hidden;
  const answer = await nextLine();
  muted = false;
  if (hidden) process.stdout.write('\n');
  return answer.trim() || fallback;
}

const PLATFORMS: Record<string, string> = {
  win32: 'windows',
  darwin: 'macos',
  linux: 'linux',
};

// Accepts either the full emailed link (…/?token=xyz) or the bare token.
function extractMagicToken(input: string): string {
  try {
    const token = new URL(input).searchParams.get('token');
    if (token) return token;
  } catch {
    // not a URL — treat as a raw token
  }
  return input;
}

/**
 * Magic-link sign-in: request a link for the email, then either verify the
 * token the server handed back directly (UNSAFE_LOCAL_NETWORK deployments) or
 * ask the user to paste the link from their inbox.
 */
async function signInWithMagicLink(serverUrl: string, email: string): Promise<string> {
  const { requestMagicLink } = await gql<{ requestMagicLink: { token: string | null } }>(
    serverUrl,
    'mutation ($email: String!) { requestMagicLink(email: $email) { token } }',
    { email },
  );

  let token = requestMagicLink.token;
  if (!token) {
    const pasted = await prompt(`Sign-in link sent to ${email}. Paste the link (or token) here: `);
    token = extractMagicToken(pasted);
  }

  const { verifyMagicLink } = await gql<{ verifyMagicLink: { token: string } }>(
    serverUrl,
    'mutation ($token: String!) { verifyMagicLink(token: $token) { token } }',
    { token },
  );
  return verifyMagicLink.token;
}

export async function runProvisioning(dataDir: string): Promise<void> {
  const serverUrl = await prompt('Server URL [http://localhost:4000]: ', {
    fallback: process.env.EUNOMIA_SERVER_URL ?? 'http://localhost:4000',
  });
  const email = await prompt('Email: ');
  const name = await prompt(`Device name [${hostname()}]: `, { fallback: hostname() });
  const platform = PLATFORMS[process.platform] ?? 'linux';

  const sessionToken = await signInWithMagicLink(serverUrl, email);

  const { registerDevice } = await gql<{
    registerDevice: { device: { id: string }; apiKey: string };
  }>(
    serverUrl,
    'mutation ($name: String!, $platform: String!) { registerDevice(name: $name, platform: $platform) { device { id } apiKey } }',
    { name, platform },
    sessionToken,
  );

  const configPath = join(dataDir, 'config.json');
  writeFileSync(
    configPath,
    `${JSON.stringify({ serverUrl, apiKey: registerDevice.apiKey }, null, 2)}\n`,
  );

  // The interactive session has done its job; the agent runs on the API key.
  await gql(serverUrl, 'mutation { signOut }', {}, sessionToken).catch(() => {});

  console.log(`device ${registerDevice.device.id} ("${name}") registered`);
  console.log(`config written to ${configPath} — start the agent normally to upload`);
}
