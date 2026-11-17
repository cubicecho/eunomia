import {
  type AgentCredential,
  beginDeviceSignIn,
  type DeviceCode,
  type PendingDeviceSignIn,
} from '@eunomia/agent';

// The desktop agent's device sign-in, held in the main process between the
// setup window's "start" and "finish" calls. The person approves eunomia in
// the system browser, where their provider session (and password manager)
// already is, rather than in a window of ours they'd have to trust with a
// password; nothing comes back to this process but the token it polls for.

/** The sign-in in flight. One at a time: starting another cancels it. */
let pending: PendingDeviceSignIn | null = null;

/**
 * Starts a sign-in at the server's provider and opens its approval page.
 * `openExternal` is Electron's shell.openExternal, passed in so this stays
 * testable without Electron.
 */
export async function startDeviceSignIn(
  serverUrl: string,
  openExternal: (url: string) => Promise<void>,
): Promise<DeviceCode> {
  cancelDeviceSignIn();
  const started = await beginDeviceSignIn(serverUrl);
  pending = started;
  const link = started.code.verificationUriComplete ?? started.code.verificationUri;
  // The one URL this process hands the OS to open: never file:, never a
  // custom scheme some other app registered.
  if (/^https?:\/\//.test(link)) await openExternal(link).catch(() => {});
  return started.code;
}

/** Waits for the started sign-in to be approved. */
export async function finishDeviceSignIn(): Promise<AgentCredential> {
  const current = pending;
  if (!current) throw new Error('No sign-in is waiting. Start again.');
  try {
    return await current.finish();
  } finally {
    if (pending === current) pending = null;
  }
}

export function cancelDeviceSignIn(): void {
  pending?.cancel();
  pending = null;
}
