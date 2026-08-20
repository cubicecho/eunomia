import { graphql } from 'graphql';
import { beforeEach, describe, expect, it } from 'vitest';
import { createAuth, createAuthGateway, verifyDeviceKey } from '../src/auth.ts';
import { activities, user } from '../src/db/schema.ts';
import type { Context } from '../src/graphql/context.ts';
import { createSchema } from '../src/graphql/schema.ts';
import { createMigratedTestDb } from './helpers/test-db.ts';

describe('device management', () => {
  let db: Awaited<ReturnType<typeof createMigratedTestDb>>;
  let auth: ReturnType<typeof createAuth>;
  let schema: ReturnType<typeof createSchema>;

  const asUser = (userId: string | undefined): Context =>
    ({ db, userId, deviceId: undefined, headers: new Headers() }) as Context;

  beforeEach(async () => {
    db = await createMigratedTestDb();
    auth = createAuth(db as never, {
      secret: 'test-secret-test-secret-test-secret',
      baseURL: 'http://localhost:4000',
    });
    schema = createSchema(db as never, createAuthGateway(auth));
    await db.insert(user).values([
      { id: 'user-1', name: 'u1', email: 'u1@example.com' },
      { id: 'user-2', name: 'u2', email: 'u2@example.com' },
    ]);
  });

  const register = async (userId: string): Promise<{ deviceId: string; apiKey: string }> => {
    const result = await graphql({
      schema,
      source: `mutation {
        registerDevice(name: "laptop", platform: "linux") { apiKey device { id } }
      }`,
      contextValue: asUser(userId),
    });
    expect(result.errors).toBeUndefined();
    const payload = (result.data as any).registerDevice;
    return { deviceId: payload.device.id, apiKey: payload.apiKey };
  };

  const rename = (userId: string | undefined, deviceId: string, name: string) =>
    graphql({
      schema,
      source: `mutation ($id: String!, $name: String!) {
        renameDevice(id: $id, name: $name) { id name }
      }`,
      variableValues: { id: deviceId, name },
      contextValue: asUser(userId),
    });

  const remove = (userId: string | undefined, deviceId: string) =>
    graphql({
      schema,
      source: `mutation ($id: String!) { deleteDevice(id: $id) }`,
      variableValues: { id: deviceId },
      contextValue: asUser(userId),
    });

  it('renames an owned device', async () => {
    const { deviceId } = await register('user-1');
    const result = await rename('user-1', deviceId, 'work laptop');
    expect(result.errors).toBeUndefined();
    expect((result.data as any).renameDevice).toEqual({ id: deviceId, name: 'work laptop' });
  });

  it("rejects renaming another user's device", async () => {
    const { deviceId } = await register('user-1');
    const result = await rename('user-2', deviceId, 'mine now');
    expect(result.errors?.[0]?.message).toBe('Unknown device');
  });

  it('deletes a device, cascading activities and revoking its API key', async () => {
    const { deviceId, apiKey } = await register('user-1');
    const survivor = await register('user-1');
    await db.insert(activities).values({
      id: 'act-1',
      deviceId,
      app: 'code',
      startedAt: new Date(),
      lastActiveAt: new Date(),
      activeSeconds: 10,
    });
    expect(await verifyDeviceKey(auth, apiKey)).toEqual({ userId: 'user-1', deviceId });

    const result = await remove('user-1', deviceId);
    expect(result.errors).toBeUndefined();
    expect((result.data as any).deleteDevice).toBe(true);

    // Device and its activities are gone; the key no longer authenticates.
    expect(await db.query.devices.findMany()).toEqual([
      expect.objectContaining({ id: survivor.deviceId }),
    ]);
    expect(await db.query.activities.findMany()).toEqual([]);
    expect(await verifyDeviceKey(auth, apiKey)).toBeNull();

    // The surviving device's key is untouched.
    expect(await verifyDeviceKey(auth, survivor.apiKey)).toEqual({
      userId: 'user-1',
      deviceId: survivor.deviceId,
    });
  });

  it("rejects deleting another user's device", async () => {
    const { deviceId, apiKey } = await register('user-1');
    const result = await remove('user-2', deviceId);
    expect(result.errors?.[0]?.message).toBe('Unknown device');
    expect(await verifyDeviceKey(auth, apiKey)).not.toBeNull();
  });

  it('rejects unauthenticated calls', async () => {
    const { deviceId } = await register('user-1');
    const result = await remove(undefined, deviceId);
    expect(result.errors?.[0]?.message).toBe('Not authenticated');
  });
});
