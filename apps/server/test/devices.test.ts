import { eq } from 'drizzle-orm';
import { graphql } from 'graphql';
import { beforeEach, describe, expect, it } from 'vitest';
import { createAuth, createAuthGateway, verifyDeviceKey } from '../src/auth.ts';
import { activities, devices, summaries, user } from '../src/db/schema.ts';
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
    schema = createSchema(db as never, createAuthGateway(auth, db as never));
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

  const rotate = (userId: string | undefined, deviceId: string) =>
    graphql({
      schema,
      source: `mutation ($id: String!) {
        rotateDeviceKey(id: $id) { apiKey device { id name } }
      }`,
      variableValues: { id: deviceId },
      contextValue: asUser(userId),
    });

  const merge = (userId: string | undefined, deviceId: string, intoId: string) =>
    graphql({
      schema,
      source: `mutation ($id: String!, $intoId: String!) {
        mergeDevice(id: $id, intoId: $intoId) { id name }
      }`,
      variableValues: { id: deviceId, intoId },
      contextValue: asUser(userId),
    });

  const remove = (userId: string | undefined, deviceId: string) =>
    graphql({
      schema,
      source: 'mutation ($id: String!) { deleteDevice(id: $id) }',
      variableValues: { id: deviceId },
      contextValue: asUser(userId),
    });

  it('stamps lastSeenAt when a ping arrives', async () => {
    const { deviceId } = await register('user-1');
    const before = new Date();
    const result = await graphql({
      schema,
      source: `mutation ($id: String!) {
        recordPing(deviceId: $id, capturedAt: "2026-08-10T09:00:00Z", app: "code", idleSeconds: 0) { id }
      }`,
      variableValues: { id: deviceId },
      contextValue: asUser('user-1'),
    });
    expect(result.errors).toBeUndefined();

    const [device] = await db.select().from(devices).where(eq(devices.id, deviceId));
    // Receipt time, not the (retroactive) capturedAt.
    expect(device?.lastSeenAt?.getTime()).toBeGreaterThanOrEqual(before.getTime());
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

  it('rotates a key: same device, new key works, old one is revoked', async () => {
    const { deviceId, apiKey } = await register('user-1');
    const survivor = await register('user-1');

    const result = await rotate('user-1', deviceId);
    expect(result.errors).toBeUndefined();
    const payload = (result.data as any).rotateDeviceKey;
    expect(payload.device).toEqual({ id: deviceId, name: 'laptop' });
    expect(payload.apiKey).not.toBe(apiKey);

    // The device (and its history) stays put; only the credential changes.
    expect(await verifyDeviceKey(auth, payload.apiKey)).toEqual({ userId: 'user-1', deviceId });
    expect(await verifyDeviceKey(auth, apiKey)).toBeNull();
    expect(await verifyDeviceKey(auth, survivor.apiKey)).toEqual({
      userId: 'user-1',
      deviceId: survivor.deviceId,
    });
  });

  it("rejects rotating another user's device key", async () => {
    const { deviceId, apiKey } = await register('user-1');
    const result = await rotate('user-2', deviceId);
    expect(result.errors?.[0]?.message).toBe('Unknown device');
    expect(await verifyDeviceKey(auth, apiKey)).not.toBeNull();
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

  it('merges a duplicate device into the one that stays, keeping its history', async () => {
    // The registered-twice case: the old row holds real history, the agent is
    // running against the new one. Deleting the old row is what lost it.
    const duplicate = await register('user-1');
    const keeper = await register('user-1');
    await db.insert(activities).values([
      {
        id: 'act-closed',
        deviceId: duplicate.deviceId,
        app: 'code',
        startedAt: new Date('2026-08-10T09:00:00Z'),
        lastActiveAt: new Date('2026-08-10T09:10:00Z'),
        closedAt: new Date('2026-08-10T09:10:00Z'),
        activeSeconds: 600,
      },
      {
        id: 'act-open',
        deviceId: duplicate.deviceId,
        app: 'firefox',
        startedAt: new Date('2026-08-10T10:00:00Z'),
        lastActiveAt: new Date('2026-08-10T10:05:00Z'),
        activeSeconds: 300,
      },
    ]);
    await db
      .update(devices)
      .set({ lastSeenAt: new Date('2026-08-10T10:05:00Z') })
      .where(eq(devices.id, duplicate.deviceId));

    const result = await merge('user-1', duplicate.deviceId, keeper.deviceId);
    expect(result.errors).toBeUndefined();
    expect((result.data as any).mergeDevice).toEqual({ id: keeper.deviceId, name: 'laptop' });

    // One device left, holding both activities.
    expect(await db.query.devices.findMany()).toEqual([
      expect.objectContaining({ id: keeper.deviceId }),
    ]);
    const moved = await db.select().from(activities).orderBy(activities.id);
    expect(moved.map((a) => ({ id: a.id, deviceId: a.deviceId }))).toEqual([
      { id: 'act-closed', deviceId: keeper.deviceId },
      { id: 'act-open', deviceId: keeper.deviceId },
    ]);
    // The open one is closed on the way over, so the keeper never ends up with
    // two open rows fold would fight over.
    expect(moved.find((a) => a.id === 'act-open')?.closedAt).toEqual(
      new Date('2026-08-10T10:05:00Z'),
    );
    // Liveness carries forward from whichever device pinged last.
    const [kept] = await db.select().from(devices).where(eq(devices.id, keeper.deviceId));
    expect(kept?.lastSeenAt).toEqual(new Date('2026-08-10T10:05:00Z'));

    // Only the retired device's key is revoked — the running agent keeps going.
    expect(await verifyDeviceKey(auth, duplicate.apiKey)).toBeNull();
    expect(await verifyDeviceKey(auth, keeper.apiKey)).toEqual({
      userId: 'user-1',
      deviceId: keeper.deviceId,
    });
  });

  it('adds up summary rows the two devices both have', async () => {
    // summaries are keyed by deviceId first, so re-pointing alone would break
    // the unique key wherever both devices recorded the same day and app.
    const duplicate = await register('user-1');
    const keeper = await register('user-1');
    await db.insert(summaries).values([
      { id: 's1', deviceId: duplicate.deviceId, day: '2026-08-10', app: 'code', seconds: 600 },
      { id: 's2', deviceId: keeper.deviceId, day: '2026-08-10', app: 'code', seconds: 300 },
      { id: 's3', deviceId: duplicate.deviceId, day: '2026-08-11', app: 'firefox', seconds: 120 },
    ]);

    expect((await merge('user-1', duplicate.deviceId, keeper.deviceId)).errors).toBeUndefined();

    const rows = await db.select().from(summaries).orderBy(summaries.day);
    expect(
      rows.map(({ deviceId, day, app, seconds }) => ({ deviceId, day, app, seconds })),
    ).toEqual([
      { deviceId: keeper.deviceId, day: '2026-08-10', app: 'code', seconds: 900 },
      { deviceId: keeper.deviceId, day: '2026-08-11', app: 'firefox', seconds: 120 },
    ]);
  });

  it('rejects merging a device into itself', async () => {
    const { deviceId } = await register('user-1');
    const result = await merge('user-1', deviceId, deviceId);
    expect(result.errors?.[0]?.message).toBe('Pick a different device to merge into');
  });

  it("rejects merging with another user's device on either end", async () => {
    const mine = await register('user-1');
    const theirs = await register('user-2');

    expect((await merge('user-1', theirs.deviceId, mine.deviceId)).errors?.[0]?.message).toBe(
      'Unknown device',
    );
    expect((await merge('user-1', mine.deviceId, theirs.deviceId)).errors?.[0]?.message).toBe(
      'Unknown device',
    );
    // Both devices survive untouched.
    expect(await verifyDeviceKey(auth, theirs.apiKey)).not.toBeNull();
    expect(await verifyDeviceKey(auth, mine.apiKey)).not.toBeNull();
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
