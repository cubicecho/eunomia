import type { AgentCredential } from './credential.ts';
import {
  type DeviceSignIn,
  discoverProvider,
  fetchDeviceSignIn,
  pollDeviceToken,
  startDeviceAuthorization,
} from './device-flow.ts';

// One device sign-in from start to credential, for a shell to drive: begin it,
// show the person the code and open the link, then wait for the credential.
// The steps (device-flow.ts) are the same on every shell; what differs is only
// where they run — the Electron main process, which no renderer CORS rule
// reaches, or the Android app itself.

/** What the person is shown while the agent waits. */
export interface DeviceCode {
  /** What the provider is called, for "Approve eunomia at …". */
  providerName: string;
  /** The code to check against what the provider's page shows. */
  userCode: string;
  /** Where to approve it. */
  verificationUri: string;
  /** The same page with the code already filled in, when the provider gives one. Open this one. */
  verificationUriComplete: string | null;
}

/** A sign-in waiting for the person to approve it. */
export interface PendingDeviceSignIn {
  code: DeviceCode;
  /** Resolves when the code is approved; rejects (a DeviceFlowError) when denied, expired or cancelled. */
  finish(): Promise<AgentCredential>;
  cancel(): void;
}

export interface DeviceSignInOptions {
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

/** Whether the server offers device sign-in: what its provider is called, or null. Never throws. */
export async function deviceSignInProvider(
  serverUrl: string,
  options: DeviceSignInOptions = {},
): Promise<string | null> {
  try {
    return (await fetchDeviceSignIn(serverUrl, options.fetch))?.providerName ?? null;
  } catch {
    return null;
  }
}

/**
 * Starts a device sign-in against the server's provider. Throws when the
 * server offers none or the provider refuses to start one.
 */
export async function beginDeviceSignIn(
  serverUrl: string,
  options: DeviceSignInOptions = {},
): Promise<PendingDeviceSignIn> {
  const signIn: DeviceSignIn | null = await fetchDeviceSignIn(serverUrl, options.fetch);
  if (!signIn) throw new Error('This server does not offer signing in through a provider.');
  const endpoints = await discoverProvider(signIn.issuer, options.fetch);
  const device = await startDeviceAuthorization(
    endpoints,
    signIn.clientId,
    signIn.audience,
    options.fetch,
  );
  const abort = new AbortController();
  return {
    code: {
      providerName: signIn.providerName,
      userCode: device.userCode,
      verificationUri: device.verificationUri,
      verificationUriComplete: device.verificationUriComplete,
    },
    async finish() {
      const tokens = await pollDeviceToken(endpoints, signIn.clientId, device, {
        fetch: options.fetch,
        sleep: options.sleep,
        now: options.now,
        signal: abort.signal,
      });
      return {
        kind: 'provider',
        ...tokens,
        issuer: endpoints.issuer,
        clientId: signIn.clientId,
        audience: signIn.audience,
        tokenEndpoint: endpoints.tokenEndpoint,
      };
    },
    cancel: () => abort.abort(),
  };
}
