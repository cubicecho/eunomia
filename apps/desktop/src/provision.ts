import { hostname } from 'node:os';
import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';
import {
  DEFAULT_SYNC_INTERVAL_SECONDS,
  MIN_SYNC_INTERVAL_SECONDS,
  normalizeServerUrl,
  provisionDevice,
  requestMagicLink,
} from '@eunomia/agent';
import { type DesktopConfig, loadConfig, platformName, writeAgentConfig } from './config.ts';

// One-shot terminal flow (run with --provision): collect the answers, hand
// them to provisionDevice, and write the userData config.json the tray agent
// uploads with. Everything about how a device is claimed — the sign-in, the
// register-or-re-key choice, disposing of the session — lives there, shared
// with the setup window and the Android agent.

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
 * Requests a magic link for the email and returns something provisionDevice
 * can verify: either the token the server handed back directly
 * (UNSAFE_LOCAL_NETWORK deployments) or the link pasted from the inbox.
 */
async function magicLinkToken(serverUrl: string, email: string): Promise<string> {
  const token = await requestMagicLink(serverUrl, email);
  if (token) return token;
  return prompt(`Sign-in link sent to ${email}. Paste the link (or token) here: `);
}

export async function runProvisioning(dataDir: string): Promise<void> {
  // What this install already is, if anything: re-running --provision on a
  // provisioned machine should re-key its device, not register a twin.
  const current = loadConfig(dataDir);
  const defaultUrl =
    current?.serverUrl ?? process.env.EUNOMIA_SERVER_URL ?? 'http://localhost:4000';
  const serverUrl = normalizeServerUrl(
    await prompt(`Server URL [${defaultUrl}]: `, { fallback: defaultUrl }),
  );
  const email = await prompt('Email: ');
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

  const provisioned = await provisionDevice({
    serverUrl,
    tokenOrLink: await magicLinkToken(serverUrl, email),
    name,
    platform: platformName(),
    existing: current,
  });

  // deviceId/deviceName are recorded so a later reconnect — here or from the
  // tray — re-keys this device instead of registering a duplicate. Privacy
  // rules and the launch-at-login choice are the user's; they carry across.
  const config: DesktopConfig = {
    ...current,
    serverUrl: provisioned.serverUrl,
    apiKey: provisioned.apiKey,
    deviceId: provisioned.deviceId,
    deviceName: name,
    syncIntervalSeconds,
  };
  const configPath = writeAgentConfig(dataDir, config);

  console.log(
    `device ${provisioned.deviceId} ("${name}") ${provisioned.reKeyed ? 're-keyed' : 'registered'}`,
  );
  console.log(`config written to ${configPath} — start the agent normally to upload`);
}
