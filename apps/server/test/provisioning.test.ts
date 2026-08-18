import { graphql } from 'graphql';
import { beforeEach, describe, expect, it } from 'vitest';
import { createAuth, createAuthGateway, verifyDeviceKey } from '../src/auth.ts';
import { user } from '../src/db/schema.ts';
import type { Context } from '../src/graphql/context.ts';
import { createSchema } from '../src/graphql/schema.ts';
import { createMigratedTestDb } from './helpers/test-db.ts';

describe('device provisioning', () => {
  let db: Awaited<ReturnType<typeof createMigratedTestDb>>;
  let auth: ReturnType<typeof createAuth>;
  let schema: ReturnType<typeof createSchema>;

  const asUser = (userId: string | undefined, deviceId?: string): Context =>
    ({ db, userId, deviceId, headers: new Headers() }) as Context;

  beforeEach(async () => {
    db = await createMigratedTestDb();
    auth = createAuth(db as never, {
      secret: 'test-secret-test-secret-test-secret',
      baseURL: 'http://localhost:4000',
    });
    schema = createSchema(db as never, createAuthGateway(auth));
    await db.insert(user).values({ id: 'user-1', name: 'u', email: 'u@example.com' });
  });

  const register = (contextValue: Context) =>
    graphql({
      schema,
      source: `mutation {
        registerDevice(name: "laptop", platform: "linux") {
          apiKey
          device { id name platform userId }
        }
      }`,
      contextValue,
    });

  it('registers a device and returns a working API key exactly once', async () => {
    const result = await register(asUser('user-1'));

    expect(result.errors).toBeUndefined();
    const payload = (result.data as any).registerDevice;
    expect(payload.device.userId).toBe('user-1');
    expect(payload.apiKey).toEqual(expect.any(String));
    expect(payload.apiKey.length).toBeGreaterThan(20);

    // The key round-trips to the user + device it was minted for.
    const creds = await verifyDeviceKey(auth, payload.apiKey);
    expect(creds).toEqual({ userId: 'user-1', deviceId: payload.device.id });
  });

  it('rejects unauthenticated registration', async () => {
    const result = await register(asUser(undefined));
    expect(result.errors?.[0]?.message).toBe('Not authenticated');
  });

  it('resolves garbage keys to null', async () => {
    expect(await verifyDeviceKey(auth, 'not-a-real-key')).toBeNull();
  });

  it('records pings without an explicit deviceId when a device key authenticates', async () => {
    const registered = await register(asUser('user-1'));
    const { apiKey, device } = (registered.data as any).registerDevice;
    const creds = await verifyDeviceKey(auth, apiKey);

    const result = await graphql({
      schema,
      source: `mutation {
        recordPing(capturedAt: "2026-08-16T12:00:00.000Z", app: "code", idleSeconds: 0) {
          id deviceId app
        }
      }`,
      contextValue: asUser(creds!.userId, creds!.deviceId),
    });

    expect(result.errors).toBeUndefined();
    expect((result.data as any).recordPing.deviceId).toBe(device.id);
  });

  it('refuses pings that name a device the caller does not own', async () => {
    const registered = await register(asUser('user-1'));
    const { device } = (registered.data as any).registerDevice;
    await db.insert(user).values({ id: 'user-2', name: 'v', email: 'v@example.com' });

    const result = await graphql({
      schema,
      source: `mutation {
        recordPing(deviceId: "${device.id}", capturedAt: "2026-08-16T12:00:00.000Z", app: "code", idleSeconds: 0) {
          id
        }
      }`,
      contextValue: asUser('user-2'),
    });

    expect(result.errors?.[0]?.message).toBe('Unknown device');
  });
});
