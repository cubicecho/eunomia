import type { Db } from '../db/client.ts';
import { oidcDeviceClientId } from './config.ts';
import { readPairedOidc, type SsoSource } from './settings.ts';

// Which public client the agents (desktop, Android) should use at the provider
// for the device flow (RFC 8628). OIDC_DEVICE_CLIENT_ID wins. Otherwise it is
// the device client pairing registered, but only once the provider lets it use
// the device flow: heautou holds it back until its admin turns it on, and
// removes the client when they turn it off. eunomia reads its registration
// (RFC 7592) to see which, and remembers the answer for DEVICE_CHECK_MS,
// because `ssoSetup` is read signed out.

/** The device code grant (RFC 8628). */
export const DEVICE_CODE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code';

/** How long the provider's answer about the device flow is kept before asking again. */
const DEVICE_CHECK_MS = 60_000;
/** How long asking the provider may take before the answer is "no". */
const CHECK_TIMEOUT_MS = 10_000;

/** The last answer the provider gave, and until when it stands. */
interface Checked {
  /** The registration the answer is about. */
  uri: string;
  hasDeviceFlow: boolean;
  /** When to ask again, in epoch milliseconds. */
  until: number;
}

let checked: Checked | null = null;

/**
 * Asks the provider whether the device client has the device flow now. False
 * when its registration doesn't list the grant, the client is gone, or the
 * provider can't be reached.
 */
async function hasDeviceFlow(uri: string, token: string): Promise<boolean> {
  try {
    const response = await fetch(uri, {
      headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
      signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
    });
    if (!response.ok) return false;
    const body: unknown = await response.json();
    const grants =
      body && typeof body === 'object'
        ? (body as { grant_types?: unknown }).grant_types
        : undefined;
    return Array.isArray(grants) && grants.includes(DEVICE_CODE_GRANT);
  } catch {
    return false;
  }
}

/**
 * The device client to tell the agents about: OIDC_DEVICE_CLIENT_ID with a
 * provider from the environment, else the paired device client while it has
 * the device flow, else null.
 */
export async function deviceClientId(
  db: Db,
  source: SsoSource,
  now = Date.now(),
): Promise<string | null> {
  if (source === 'ENV') return oidcDeviceClientId();
  if (source !== 'PAIRED') return null;
  const paired = await readPairedOidc(db);
  const uri = paired?.deviceRegistrationClientUri;
  const token = paired?.deviceRegistrationAccessToken;
  if (!paired?.deviceClientId || !uri || !token) return null;
  if (checked === null || checked.uri !== uri || checked.until <= now) {
    checked = {
      uri,
      hasDeviceFlow: await hasDeviceFlow(uri, token),
      until: now + DEVICE_CHECK_MS,
    };
  }
  return checked.hasDeviceFlow ? paired.deviceClientId : null;
}

/** Forgets the remembered answer, so the next read asks the provider. After pairing changes, and for tests. */
export function forgetDeviceClientCheck(): void {
  checked = null;
}
