import {
  createTokenSource,
  provisionDevice,
  registerDevice,
  requestMagicLink,
  uploadBatch,
  verifyMagicLink,
} from '@eunomia/agent';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.ts';
import { createAuth, createAuthGateway } from '../src/auth.ts';
import { fixedAuthHost } from '../src/auth-host.ts';
import { createMigratedTestDb } from './helpers/test-db.ts';

// The agent side of "change server / sign in again" (desktop tray → setup
// window), driven through the shared @eunomia/agent calls the desktop actually
// makes rather than through hand-written queries: sign in, keep the device this
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
      fixedAuthHost(auth),
      // The desktop's flow needs the magic token in the response; that's what
      // UNSAFE_LOCAL_NETWORK deployments do.
      createAuthGateway(fixedAuthHost(auth), db as never, { exposeMagicLinkToken: true }),
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

  it('keeps the device it already owns instead of registering a twin', async () => {
    const firstSession = await signIn();
    const deviceId = await registerDevice(serverUrl, firstSession, 'laptop', 'linux');

    const token = await signIn();
    const again = await provisionDevice({
      serverUrl: `${serverUrl}/`,
      credential: { kind: 'session', token },
      name: 'work laptop',
      platform: 'linux',
      existing: { serverUrl, deviceId, deviceName: 'laptop' },
    });
    expect(again).toEqual({ serverUrl, deviceId, reconnected: true });

    const tokens = createTokenSource({ kind: 'session', token });
    expect(await uploadBatch({ serverUrl, deviceId, tokens }, [ping])).toEqual({
      accepted: true,
      error: null,
    });
  });

  it('registers a new device when the one it remembers is gone', async () => {
    const token = await signIn();
    const fresh = await provisionDevice({
      serverUrl,
      credential: { kind: 'session', token },
      name: 'laptop',
      platform: 'linux',
      existing: { serverUrl, deviceId: 'deleted-device', deviceName: 'laptop' },
    });
    expect(fresh.reconnected).toBe(false);
    expect(fresh.deviceId).not.toBe('deleted-device');
  });
});
