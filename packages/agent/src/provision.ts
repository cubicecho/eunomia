import { GraphQLRequestError, registerDevice, renameDevice, UNAUTHENTICATED } from './api.ts';
import type { AgentCredential } from './credential.ts';

// The one place that decides how an agent becomes (or stays) a device on a
// server. Desktop's setup window, `npm run provision`, and the Android setup
// screen all differ in how they sign in — the provider's device flow, or a
// sign-in link; from there on the steps are identical, and every copy of them
// was a chance for one platform to drift into registering duplicate devices.

/**
 * What an already-provisioned install knows about itself — the subset of its
 * config that decides whether this is a reconnect or a first registration.
 * Read from configs of every age, including ones from before agents signed in
 * as their person (which held an API key instead).
 */
export interface DeviceIdentity {
  serverUrl: string;
  deviceId?: string | undefined;
  deviceName?: string | undefined;
}

export interface ProvisionInput {
  serverUrl: string;
  /** What the agent signed in with. */
  credential: AgentCredential;
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
  /** True when the device this install already had was kept instead of a new one registered. */
  reconnected: boolean;
}

/**
 * Trailing slashes and stray whitespace make two spellings of one server, and
 * the reconnect check below is an equality test — so both sides go through here.
 */
export function normalizeServerUrl(serverUrl: string): string {
  return serverUrl.trim().replace(/\/+$/, '');
}

const bearerOf = (credential: AgentCredential): string =>
  credential.kind === 'provider' ? credential.accessToken : credential.token;

/**
 * What to tell the person when the server refuses a fresh provider token: it
 * verified at the provider, but eunomia has no account that ever signed in
 * through it, and it only maps a token to one that has (never by email).
 */
const NOT_LINKED =
  "eunomia doesn't know this account yet. Sign in to the eunomia dashboard with your provider once, then try again.";

/**
 * Puts this machine on the server as the person the credential signs in as.
 *
 * Registering is the fallback, not the default: an install that already owns a
 * device on this server keeps it (renaming it when asked to), because
 * registering a twin strands half this machine's history on a device nothing
 * uploads to any more. That is what mergeDevice exists to repair, and not
 * creating the duplicate is better than repairing it. A device that is gone,
 * or someone else's, is NOT_FOUND to the rename, and a new one is registered.
 */
export async function provisionDevice(input: ProvisionInput): Promise<ProvisionResult> {
  const serverUrl = normalizeServerUrl(input.serverUrl);
  const name = input.name.trim();
  const bearer = bearerOf(input.credential);
  const existing = input.existing;
  const keepId =
    existing?.deviceId && normalizeServerUrl(existing.serverUrl) === serverUrl
      ? existing.deviceId
      : null;

  try {
    if (keepId) {
      try {
        await renameDevice(serverUrl, bearer, keepId, name);
        return { serverUrl, deviceId: keepId, reconnected: true };
      } catch (error) {
        if (!(error instanceof GraphQLRequestError) || error.code !== 'NOT_FOUND') throw error;
      }
    }
    const deviceId = await registerDevice(serverUrl, bearer, name, input.platform);
    return { serverUrl, deviceId, reconnected: false };
  } catch (error) {
    if (
      input.credential.kind === 'provider' &&
      error instanceof GraphQLRequestError &&
      error.code === UNAUTHENTICATED
    ) {
      throw new Error(NOT_LINKED);
    }
    throw error;
  }
}
