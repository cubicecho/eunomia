import {
  registerDevice,
  renameDevice,
  requestMagicLink,
  rotateDeviceKey,
  uploadBatch,
  verifyMagicLink,
} from '@eunomia/agent';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.ts';
import { createAuth, createAuthGateway } from '../src/auth.ts';
import { createMigratedTestDb } from './helpers/test-db.ts';

// The agent side of "change server / API key" (desktop tray → setup window),
// driven through the shared @eunomia/agent calls the desktop actually makes
// rather than through hand-written queries: sign in, re-key the device this
// machine already owns, keep uploading. Global fetch is pointed at the Yoga
// app, so the generated SDK's documents are checked against the real schema.

describe('agent reconnect', () => {
  let app: ReturnType<typeof createApp>;
  const serverUrl = 'http://server.test';

  beforeEach(async () => {
    const db = await createMigratedTestDb();
    const auth = createAuth(db as never, {
      secret: 'test-secret-test-secret-test-secret',
      baseURL: serverUrl,
    });
    app = createApp(
      db as never,
      auth,
      // The desktop's flow needs the magic token in the response; that's what
      // UNSAFE_LOCAL_NETWORK deployments do.
      createAuthGateway(auth, db as never, { exposeMagicLinkToken: true }),
    );
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) =>
      app.fetch(new Request(String(input), init)),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** Magic-link sign-in, the way the setup window does it. */
  const signIn = async (): Promise<string> => {
    const token = await requestMagicLink(serverUrl, 'u@example.com');
    expect(token).toEqual(expect.any(String));
    return verifyMagicLink(serverUrl, token ?? '');
  };

  const ping = {
    capturedAt: '2026-08-12T09:00:00.000Z',
    app: 'code',
    title: null,
    context: null,
    idleSeconds: 0,
  };

  it('re-keys the device it already owns instead of registering a twin', async () => {
    const first = await registerDevice(serverUrl, await signIn(), 'laptop', 'linux');

    const session = await signIn();
    await renameDevice(serverUrl, session, first.deviceId, 'work laptop');
    const rotated = await rotateDeviceKey(serverUrl, session, first.deviceId);
    expect(rotated.deviceId).toBe(first.deviceId);

    // The agent keeps uploading under the new key; the old one is dead.
    expect(await uploadBatch({ serverUrl, apiKey: rotated.apiKey }, [ping])).toEqual({
      accepted: true,
      error: null,
    });
    const stale = await uploadBatch({ serverUrl, apiKey: first.apiKey }, [ping]);
    expect(stale.accepted).toBe(false);
  });
});
