import { hostname } from 'node:os';
import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';
import {
  type AgentCredential,
  beginDeviceSignIn,
  DEFAULT_SYNC_INTERVAL_SECONDS,
  deviceSignInProvider,
  MIN_SYNC_INTERVAL_SECONDS,
  normalizeServerUrl,
  provisionDevice,
  requestMagicLink,
  type StoredConfig,
  verifyMagicLink,
} from '@eunomia/agent';
import { loadSavedConfig, platformName, writeAgentConfig } from './config.ts';

// One-shot terminal flow (run with --provision): sign in, hand the answers to
// provisionDevice, and write the userData config.json the tray agent uploads
// with. How a device is claimed — keep-or-register — lives there, shared with
// the setup window and the Android agent. Signing in is the provider's device
// flow when the server offers it (a code and a link to open anywhere, which
// suits a headless machine), or a sign-in link by email otherwise.

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
 * Requests a magic link for the email and trades it for a session: either the
 * token the server handed back directly (UNSAFE_LOCAL_NETWORK deployments) or
 * the link pasted from the inbox.
 */
async function signInWithLink(serverUrl: string): Promise<AgentCredential> {
  const email = await prompt('Email: ');
  const token =
    (await requestMagicLink(serverUrl, email)) ??
    (await prompt(`Sign-in link sent to ${email}. Paste the link (or token) here: `));
  return { kind: 'session', token: await verifyMagicLink(serverUrl, token) };
}

/** The provider's device flow, in the terminal: print the code and link, then wait. */
async function signInWithProvider(serverUrl: string): Promise<AgentCredential> {
  const pending = await beginDeviceSignIn(serverUrl);
  const { providerName, userCode, verificationUri, verificationUriComplete } = pending.code;
  console.log(
    `\nTo sign in with ${providerName}, open ${verificationUriComplete ?? verificationUri}`,
  );
  console.log(`and check it shows the code ${userCode}. Waiting for you to approve it…\n`);
  return pending.finish();
}

export async function runProvisioning(dataDir: string): Promise<void> {
  // What this install already is, if anything — even a config from before
  // agents signed in as their person: running --provision again on a set-up
  // machine keeps its device, and its settings, rather than registering a twin.
  const current = loadSavedConfig(dataDir);
  const defaultUrl = current?.serverUrl ?? 'http://localhost:4000';
  const serverUrl = normalizeServerUrl(
    await prompt(`Server URL [${defaultUrl}]: `, { fallback: defaultUrl }),
  );
  const defaultName = current?.deviceName ?? hostname();
  const name = await prompt(`Device name [${defaultName}]: `, { fallback: defaultName });
  const defaultInterval = current?.syncIntervalSeconds ?? DEFAULT_SYNC_INTERVAL_SECONDS;
  const intervalAnswer = await prompt(`Sync interval in seconds [${defaultInterval}]: `, {
    fallback: String(defaultInterval),
  });
  const parsedInterval = Number(intervalAnswer);
  const syncIntervalSeconds =
    Number.isFinite(parsedInterval) && parsedInterval > 0
      ? Math.max(MIN_SYNC_INTERVAL_SECONDS, parsedInterval)
      : DEFAULT_SYNC_INTERVAL_SECONDS;

  const provider = await deviceSignInProvider(serverUrl);
  let credential: AgentCredential;
  if (provider) {
    const answer = await prompt(`Sign in with ${provider}? [Y/n, n for an email link]: `, {
      fallback: 'y',
    });
    credential = /^n/i.test(answer)
      ? await signInWithLink(serverUrl)
      : await signInWithProvider(serverUrl);
  } else {
    credential = await signInWithLink(serverUrl);
  }

  const provisioned = await provisionDevice({
    serverUrl,
    credential,
    name,
    platform: platformName(),
    existing: current,
  });

  // deviceId/deviceName are recorded so a later reconnect — here or from the
  // tray — keeps this device instead of registering a duplicate. Privacy rules
  // and the launch-at-login choice are the user's; they carry across.
  const config: StoredConfig = {
    ...current,
    serverUrl: provisioned.serverUrl,
    deviceId: provisioned.deviceId,
    credential,
    deviceName: name,
    syncIntervalSeconds,
  };
  const configPath = writeAgentConfig(dataDir, config);

  console.log(
    `device ${provisioned.deviceId} ("${name}") ${provisioned.reconnected ? 'reconnected' : 'registered'}`,
  );
  console.log(`config written to ${configPath} — start the agent normally to upload`);
}
