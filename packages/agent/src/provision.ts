import { registerDevice, renameDevice, rotateDeviceKey, signOut, verifyMagicLink } from './api.ts';

// The one place that decides how an agent becomes (or stays) a device on a
// server. Desktop's setup window, `npm run provision`, and the Android setup
// screen all differ in how they collect a magic-link token; from there on the
// steps are identical, and every copy of them was a chance for one platform to
// drift into registering duplicate devices.

/**
 * What an already-provisioned install knows about itself — the subset of its
 * config that decides whether this is a re-key or a first registration.
 * `deviceId` is absent in configs written before re-keying existed, and in
 * those the flow falls back to registering.
 */
export interface DeviceIdentity {
  serverUrl: string;
  deviceId?: string | undefined;
  deviceName?: string | undefined;
}

export interface ProvisionInput {
  serverUrl: string;
  /** The magic-link token, or the whole link pasted from an inbox. */
  tokenOrLink: string;
  /** What this device should be called on the server. */
  name: string;
  /** 'windows' | 'macos' | 'linux' | 'android'. */
  platform: string;
  /** This install's current config, when it has one. Null on first setup. */
  existing?: DeviceIdentity | null;
}

export interface ProvisionResult {
  /** The normalized server URL — write this to the config, not the raw input. */
  serverUrl: string;
  deviceId: string;
  apiKey: string;
  /** True when an existing device was re-keyed instead of a new one registered. */
  reKeyed: boolean;
}

/**
 * Trailing slashes and stray whitespace make two spellings of one server, and
 * the re-key check below is an equality test — so both sides go through here.
 */
export function normalizeServerUrl(serverUrl: string): string {
  return serverUrl.trim().replace(/\/+$/, '');
}

/**
 * Signs in with a magic-link token and puts this machine on the server, then
 * disposes of the session — agents authenticate with the returned device API
 * key, never a session.
 *
 * Registering is the fallback, not the default: an install that already owns a
 * device on this server re-keys that device (rotateDeviceKey), because
 * registering a twin strands half this machine's history on a device nothing
 * uploads to any more. That is what mergeDevice exists to repair, and not
 * creating the duplicate is better than repairing it.
 */
export async function provisionDevice(input: ProvisionInput): Promise<ProvisionResult> {
  const serverUrl = normalizeServerUrl(input.serverUrl);
  const name = input.name.trim();
  const session = await verifyMagicLink(serverUrl, input.tokenOrLink);

  // Same server and a device we already own: keep its identity.
  const existing = input.existing;
  const reKeyId =
    existing?.deviceId && normalizeServerUrl(existing.serverUrl) === serverUrl
      ? existing.deviceId
      : null;

  try {
    if (reKeyId) {
      if (name !== (existing?.deviceName ?? '')) {
        await renameDevice(serverUrl, session, reKeyId, name);
      }
      const rotated = await rotateDeviceKey(serverUrl, session, reKeyId);
      return { serverUrl, ...rotated, reKeyed: true };
    }
    const registered = await registerDevice(serverUrl, session, name, input.platform);
    return { serverUrl, ...registered, reKeyed: false };
  } finally {
    // Best-effort by design (signOut swallows): the work above is already
    // committed on the server, so a failure to tidy up the session must not
    // turn a successful provision into a failed one.
    await signOut(serverUrl, session);
  }
}
