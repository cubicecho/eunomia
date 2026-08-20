import { hostname } from 'node:os';
import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';
import {
  DEFAULT_SYNC_INTERVAL_SECONDS,
  MIN_SYNC_INTERVAL_SECONDS,
  registerDevice,
  requestMagicLink,
  signOut,
  verifyMagicLink,
} from '@eunomia/agent';
import { platformName, writeAgentConfig } from './config.ts';

// One-shot terminal flow (run with --provision): sign in via magic link,
// register this machine as a device, and write the userData config.json the
// tray agent uploads with. The session token is only held for the two calls
// and revoked at the end — the agent authenticates with the device API key.

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

/**
 * Magic-link sign-in: request a link for the email, then either verify the
 * token the server handed back directly (UNSAFE_LOCAL_NETWORK deployments) or
 * ask the user to paste the link from their inbox.
 */
async function signInWithMagicLink(serverUrl: string, email: string): Promise<string> {
  let token = await requestMagicLink(serverUrl, email);
  if (!token) {
    token = await prompt(`Sign-in link sent to ${email}. Paste the link (or token) here: `);
  }
  return verifyMagicLink(serverUrl, token);
}

export async function runProvisioning(dataDir: string): Promise<void> {
  const serverUrl = await prompt('Server URL [http://localhost:4000]: ', {
    fallback: process.env.EUNOMIA_SERVER_URL ?? 'http://localhost:4000',
  });
  const email = await prompt('Email: ');
  const name = await prompt(`Device name [${hostname()}]: `, { fallback: hostname() });
  const intervalAnswer = await prompt(
    `Sync interval in seconds [${DEFAULT_SYNC_INTERVAL_SECONDS}]: `,
    { fallback: String(DEFAULT_SYNC_INTERVAL_SECONDS) },
  );
  const parsedInterval = Number(intervalAnswer);
  const syncIntervalSeconds =
    Number.isFinite(parsedInterval) && parsedInterval > 0
      ? Math.max(MIN_SYNC_INTERVAL_SECONDS, parsedInterval)
      : DEFAULT_SYNC_INTERVAL_SECONDS;

  const sessionToken = await signInWithMagicLink(serverUrl, email);
  const { deviceId, apiKey } = await registerDevice(serverUrl, sessionToken, name, platformName());
  const configPath = writeAgentConfig(dataDir, { serverUrl, apiKey, syncIntervalSeconds });

  // The interactive session has done its job; the agent runs on the API key.
  await signOut(serverUrl, sessionToken);

  console.log(`device ${deviceId} ("${name}") registered`);
  console.log(`config written to ${configPath} — start the agent normally to upload`);
}
