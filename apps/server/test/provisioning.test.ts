import { graphql } from 'graphql';
import { beforeEach, describe, expect, it } from 'vitest';
import { deleteDeviceKeys } from '../src/api-keys.ts';
import { createAuth, createAuthGateway, mintUserKey, verifyApiKey } from '../src/auth.ts';
import { fixedAuthHost } from '../src/auth-host.ts';
import { apikey, user } from '../src/db/schema.ts';
import type { Context } from '../src/graphql/context.ts';
import { createSchema } from '../src/graphql/schema.ts';
import { sessionContext, tokenContext } from './helpers/context.ts';
import { createMigratedTestDb } from './helpers/test-db.ts';

describe('device provisioning', () => {
  let db: Awaited<ReturnType<typeof createMigratedTestDb>>;
  let auth: ReturnType<typeof createAuth>;
  let schema: ReturnType<typeof createSchema>;

  const asUser = (userId: string | undefined): Context => sessionContext(db, userId);

  beforeEach(async () => {
    db = await createMigratedTestDb();
    auth = createAuth(db as never, {
      secret: 'test-secret-test-secret-test-secret',
      baseURL: 'http://localhost:4000',
    });
    schema = createSchema(db as never, createAuthGateway(fixedAuthHost(auth), db as never));
    await db.insert(user).values({ id: 'user-1', name: 'u', email: 'u@example.com' });
  });

  const register = (contextValue: Context) =>
    graphql({
      schema,
      source: `mutation {
        registerDevice(name: "laptop", platform: "linux") { id name platform userId }
      }`,
      contextValue,
    });

  it('registers a device for the caller, with no credential of its own', async () => {
    const result = await register(asUser('user-1'));

    expect(result.errors).toBeUndefined();
    expect((result.data as any).registerDevice).toMatchObject({
      name: 'laptop',
      platform: 'linux',
      userId: 'user-1',
    });
  });

  it('lets an agent on a provider token register its device', async () => {
    const result = await register(tokenContext(db, 'user-1'));
    expect(result.errors).toBeUndefined();
    expect((result.data as any).registerDevice.userId).toBe('user-1');
  });

  it('rejects unauthenticated registration', async () => {
    const result = await register(asUser(undefined));
    expect(result.errors?.[0]?.message).toBe('Not authenticated');
  });

  it('resolves garbage keys to null', async () => {
    expect(await verifyApiKey(auth, 'not-a-real-key')).toBeNull();
  });

  it('records pings for the device they name', async () => {
    const registered = await register(tokenContext(db, 'user-1'));
    const { id } = (registered.data as any).registerDevice;

    const result = await graphql({
      schema,
      source: `mutation {
        recordPing(deviceId: "${id}", capturedAt: "2026-08-16T12:00:00.000Z", app: "code", idleSeconds: 0) {
          id deviceId app
        }
      }`,
      contextValue: tokenContext(db, 'user-1'),
    });

    expect(result.errors).toBeUndefined();
    expect((result.data as any).recordPing.deviceId).toBe(id);
  });

  it('refuses pings that name a device the caller does not own', async () => {
    const registered = await register(asUser('user-1'));
    const { id } = (registered.data as any).registerDevice;
    await db.insert(user).values({ id: 'user-2', name: 'v', email: 'v@example.com' });

    const result = await graphql({
      schema,
      source: `mutation {
        recordPing(deviceId: "${id}", capturedAt: "2026-08-16T12:00:00.000Z", app: "code", idleSeconds: 0) {
          id
        }
      }`,
      contextValue: asUser('user-2'),
    });

    expect(result.errors?.[0]?.message).toBe('Unknown device');
  });
});

describe('device keys left over from before agents signed in', () => {
  let db: Awaited<ReturnType<typeof createMigratedTestDb>>;
  let auth: ReturnType<typeof createAuth>;

  beforeEach(async () => {
    db = await createMigratedTestDb();
    auth = createAuth(db as never, {
      secret: 'test-secret-test-secret-test-secret',
      baseURL: 'http://localhost:4000',
    });
    await db.insert(user).values({ id: 'user-1', name: 'u', email: 'u@example.com' });
  });

  /** A key minted the way registerDevice used to mint one. */
  const legacyDeviceKey = async (deviceId: string) =>
    (
      await auth.api.createApiKey({
        body: { userId: 'user-1', name: 'laptop', metadata: { deviceId }, rateLimitEnabled: false },
      })
    ).key;

  it('are refused when presented', async () => {
    expect(await verifyApiKey(auth, await legacyDeviceKey('device-1'))).toBeNull();
  });

  it('are deleted at boot, and integration keys are kept', async () => {
    await legacyDeviceKey('device-1');
    await legacyDeviceKey('device-2');
    const integration = await mintUserKey(auth, { userId: 'user-1', name: 'mcp' });

    expect(await deleteDeviceKeys(db as never)).toBe(2);
    expect(await deleteDeviceKeys(db as never)).toBe(0);

    const left = await db.select({ id: apikey.id }).from(apikey);
    expect(left).toEqual([{ id: integration.id }]);
    expect(await verifyApiKey(auth, integration.key)).toMatchObject({ userId: 'user-1' });
  });
});
