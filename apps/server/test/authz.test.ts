import { eq } from 'drizzle-orm';
import { graphql } from 'graphql';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  activities,
  categories,
  categoryRules,
  devices,
  focusSegments,
  user,
} from '../src/db/schema.ts';
import type { Context } from '../src/graphql/context.ts';
import { createSchema } from '../src/graphql/schema.ts';
import { stubAuthGateway } from './helpers/stub-auth.ts';
import { createMigratedTestDb } from './helpers/test-db.ts';

describe('authorization scoping', () => {
  let db: Awaited<ReturnType<typeof createMigratedTestDb>>;
  let schema: ReturnType<typeof createSchema>;

  // null = anonymous caller (an explicit undefined would trigger the 'user-1'
  // default parameter and silently run the query authenticated).
  const asUser = (userId: string | null): Context =>
    ({
      db,
      userId: userId ?? undefined,
      deviceId: undefined,
      keyId: undefined,
      headers: new Headers(),
    }) as Context;

  const run = (source: string, userId: string | null = 'user-1') =>
    graphql({ schema, source, contextValue: asUser(userId) });

  const data = async (source: string, userId: string | null = 'user-1') => {
    const result = await run(source, userId);
    expect(result.errors).toBeUndefined();
    return result.data as any;
  };

  beforeEach(async () => {
    db = await createMigratedTestDb();
    schema = createSchema(db as never, stubAuthGateway());
    await db.insert(user).values([
      { id: 'user-1', name: 'u', email: 'u@example.com' },
      { id: 'user-2', name: 'v', email: 'v@example.com' },
    ]);
    await db.insert(devices).values([
      { id: 'device-1', userId: 'user-1', name: 'laptop', platform: 'linux' },
      { id: 'device-2', userId: 'user-2', name: 'desktop', platform: 'windows' },
    ]);
    await db.insert(categories).values([
      { id: 'cat-1', userId: 'user-1', name: 'Work' },
      { id: 'cat-2', userId: 'user-2', name: 'Games' },
    ]);
    await db.insert(categoryRules).values([
      { id: 'rule-1', userId: 'user-1', categoryId: 'cat-1', appPattern: 'code' },
      { id: 'rule-2', userId: 'user-2', categoryId: 'cat-2', appPattern: 'steam' },
    ]);
    await db.insert(activities).values([
      {
        id: 'act-1',
        deviceId: 'device-1',
        app: 'code',
        startedAt: new Date('2026-08-17T12:00:00Z'),
        lastActiveAt: new Date('2026-08-17T12:10:00Z'),
        activeSeconds: 600,
        categoryId: 'cat-1',
        categorySource: 'manual' as const,
      },
      {
        id: 'act-2',
        deviceId: 'device-1',
        app: 'firefox',
        startedAt: new Date('2026-08-17T13:00:00Z'),
        lastActiveAt: new Date('2026-08-17T13:05:00Z'),
        activeSeconds: 300,
      },
      {
        id: 'act-theirs',
        deviceId: 'device-2',
        app: 'steam',
        startedAt: new Date('2026-08-17T12:00:00Z'),
        lastActiveAt: new Date('2026-08-17T12:30:00Z'),
        activeSeconds: 1800,
      },
    ]);
  });

  it('scopes every list query to the caller', async () => {
    const mine = await data(
      '{ devices { id } activities { id } categories { id } categoryRules { id } }',
    );
    expect(mine.devices.map((d: any) => d.id)).toEqual(['device-1']);
    expect(mine.activities.map((a: any) => a.id).sort()).toEqual(['act-1', 'act-2']);
    expect(mine.categories.map((c: any) => c.id)).toEqual(['cat-1']);
    expect(mine.categoryRules.map((r: any) => r.id)).toEqual(['rule-1']);

    const theirs = await data(
      '{ devices { id } activities { id } categories { id } categoryRules { id } }',
      'user-2',
    );
    expect(theirs.devices.map((d: any) => d.id)).toEqual(['device-2']);
    expect(theirs.activities.map((a: any) => a.id)).toEqual(['act-theirs']);
    expect(theirs.categories.map((c: any) => c.id)).toEqual(['cat-2']);
    expect(theirs.categoryRules.map((r: any) => r.id)).toEqual(['rule-2']);
  });

  it('where filters cannot widen the fence', async () => {
    const direct = await data('{ devices(where: { userId: { eq: "user-1" } }) { id } }', 'user-2');
    expect(direct.devices).toEqual([]);

    const viaOr = await data(
      '{ categories(where: { OR: [{ userId: { eq: "user-1" } }, { userId: { eq: "user-2" } }] }) { id } }',
      'user-2',
    );
    expect(viaOr.categories.map((c: any) => c.id)).toEqual(['cat-2']);

    const byDevice = await data(
      '{ activities(where: { deviceId: { eq: "device-1" } }) { id } }',
      'user-2',
    );
    expect(byDevice.activities).toEqual([]);
  });

  it('relation filters cannot widen the fence either', async () => {
    // A filter that reaches through a relation is a second way to name rows,
    // and the scope is ANDed on after it — so naming someone else's device
    // through activities.device narrows to nothing rather than reaching it.
    const throughDevice = await data(
      '{ activities(where: { device: { userId: { eq: "user-1" } } }) { id } }',
      'user-2',
    );
    expect(throughDevice.activities).toEqual([]);
  });

  it('refuses a page larger than the maximum', async () => {
    // Rejected, not truncated: a short page tells a paginating client it has
    // reached the end when it has not.
    const result = await run('{ activities(limit: 5000) { id } }');
    expect(result.errors?.[0]?.message).toMatch(/exceeds the maximum/);
  });

  it('filters, ordering, and pagination still work inside the fence', async () => {
    const filtered = await data('{ activities(where: { app: { eq: "code" } }) { id app } }');
    expect(filtered.activities).toEqual([{ id: 'act-1', app: 'code' }]);

    const paged = await data(
      '{ activities(orderBy: { startedAt: { direction: desc, priority: 1 } }, limit: 1) { id startedAt } }',
    );
    // graphql-scalars' DateTime hands back Date objects for in-process calls.
    expect(paged.activities).toEqual([
      { id: 'act-2', startedAt: new Date('2026-08-17T13:00:00.000Z') },
    ]);
  });

  it('nested relations only traverse the caller-owned graph', async () => {
    const result = await data(
      '{ categories { id activities { id } } devices { id activities { id } } }',
    );
    expect(result.categories).toEqual([{ id: 'cat-1', activities: [{ id: 'act-1' }] }]);
    // Newest first, relation reads included: activities carry a default
    // orderBy (entities.ts) for requests that name none.
    expect(result.devices).toEqual([
      { id: 'device-1', activities: [{ id: 'act-2' }, { id: 'act-1' }] },
    ]);
  });

  it('scopes focus segments to the caller, through filters and relations alike', async () => {
    const segment = (id: string, deviceId: string, activityId: string, minute: number) => ({
      id,
      deviceId,
      activityId,
      startedAt: new Date(Date.UTC(2026, 7, 17, 12, minute)),
      endedAt: new Date(Date.UTC(2026, 7, 17, 12, minute + 1)),
    });
    await db
      .insert(focusSegments)
      .values([
        segment('seg-2', 'device-1', 'act-2', 5),
        segment('seg-1', 'device-1', 'act-1', 0),
        segment('seg-theirs', 'device-2', 'act-theirs', 0),
      ]);

    // Oldest first by default: segments are read as a timeline.
    const mine = await data('{ focusSegments { id activity { app } } }');
    expect(mine.focusSegments).toEqual([
      { id: 'seg-1', activity: { app: 'code' } },
      { id: 'seg-2', activity: { app: 'firefox' } },
    ]);
    const theirs = await data('{ focusSegments { id } }', 'user-2');
    expect(theirs.focusSegments).toEqual([{ id: 'seg-theirs' }]);

    // The read a timeline makes: one device, one time range.
    const ranged = await data(
      '{ focusSegments(where: { deviceId: { eq: "device-1" }, startedAt: { gte: "2026-08-17T12:03:00Z" } }) { id } }',
    );
    expect(ranged.focusSegments).toEqual([{ id: 'seg-2' }]);

    for (const where of [
      '{ deviceId: { eq: "device-1" } }',
      '{ device: { userId: { eq: "user-1" } } }',
      '{ activity: { app: { eq: "code" } } }',
    ]) {
      const widened = await data(`{ focusSegments(where: ${where}) { id } }`, 'user-2');
      expect(widened.focusSegments).toEqual([]);
    }

    expect((await run('{ focusSegments { id } }', null)).errors?.[0]?.message).toBe(
      'Not authenticated',
    );
  });

  it('rejects anonymous access to protected fields but not public ones', async () => {
    for (const source of [
      '{ devices { id } }',
      '{ activities { id } }',
      '{ categories { id } }',
      '{ categoryRules { id } }',
      'mutation { applyCategoryRules }',
      'mutation { registerDevice(name: "x", platform: "linux") { apiKey } }',
    ]) {
      const result = await run(source, null);
      expect(result.errors?.[0]?.message).toBe('Not authenticated');
    }

    const me = await data('{ me { id } }', null);
    expect(me.me).toBeNull();
  });

  it('answers me with the caller alone, key or session', async () => {
    await db.update(user).set({ timeZone: 'Asia/Tokyo' }).where(eq(user.id, 'user-2'));
    const source = '{ me { id timeZone effectiveTimeZone } }';
    expect((await data(source)).me).toEqual({
      id: 'user-1',
      timeZone: null,
      // The test database's session zone — what the server's TZ is in prod.
      effectiveTimeZone: 'UTC',
    });
    expect((await data(source, 'user-2')).me).toEqual({
      id: 'user-2',
      timeZone: 'Asia/Tokyo',
      effectiveTimeZone: 'Asia/Tokyo',
    });
    const viaKey = { ...asUser('user-1'), keyId: 'key-1' } as Context;
    const keyed = await graphql({ schema, source, contextValue: viaKey });
    expect((keyed.data as any).me.id).toBe('user-1');
  });

  it('lets only a signed-in user set their own time zone', async () => {
    const set = (timeZone: string | null, contextValue: Context) =>
      graphql({
        schema,
        source: `mutation ($tz: String) { setTimeZone(timeZone: $tz) { id timeZone effectiveTimeZone } }`,
        variableValues: { tz: timeZone },
        contextValue,
      });

    expect((await set('Asia/Tokyo', asUser(null))).errors?.[0]?.message).toBe('Not authenticated');
    // A key acts as its owner everywhere else, but not here.
    const viaKey = { ...asUser('user-1'), keyId: 'key-1' } as Context;
    expect((await set('Asia/Tokyo', viaKey)).errors?.[0]?.message).toBe('Not authenticated');
    const zones = async () =>
      (await db.select({ id: user.id, timeZone: user.timeZone }).from(user)).sort((a, b) =>
        a.id.localeCompare(b.id),
      );
    expect(await zones()).toEqual([
      { id: 'user-1', timeZone: null },
      { id: 'user-2', timeZone: null },
    ]);

    // Stored as Intl spells it, however it was typed.
    const mine = await set(' america/chicago ', asUser('user-1'));
    expect(mine.errors).toBeUndefined();
    expect((mine.data as any).setTimeZone).toEqual({
      id: 'user-1',
      timeZone: 'America/Chicago',
      effectiveTimeZone: 'America/Chicago',
    });
    // There is no argument naming whose zone: it is always the caller's.
    expect(await zones()).toEqual([
      { id: 'user-1', timeZone: 'America/Chicago' },
      { id: 'user-2', timeZone: null },
    ]);

    // Not zones: nonsense, a POSIX string Postgres would read backwards, and
    // a bare offset Intl takes but pg_timezone_names doesn't list.
    for (const bad of ['Mars/Olympus', 'UTC+5', '+05:00', '']) {
      const result = await set(bad, asUser('user-1'));
      expect(result.errors?.[0]?.extensions?.code).toBe('BAD_USER_INPUT');
    }

    const cleared = await set(null, asUser('user-1'));
    expect((cleared.data as any).setTimeZone).toEqual({
      id: 'user-1',
      timeZone: null,
      effectiveTimeZone: 'UTC',
    });
  });

  it('lets only a signed-in owner replay a device', async () => {
    const replay = (id: string, contextValue: Context) =>
      graphql({
        schema,
        source: `mutation ($id: String!) { replayDevice(id: $id) { from pings activities } }`,
        variableValues: { id },
        contextValue,
      });

    expect((await replay('device-1', asUser(null))).errors?.[0]?.message).toBe('Not authenticated');
    // An API key — even the device's own — can't rewrite its history.
    const viaKey = { ...asUser('user-1'), keyId: 'key-1', deviceId: 'device-1' } as Context;
    expect((await replay('device-1', viaKey)).errors?.[0]?.message).toBe('Not authenticated');
    // Someone else's device is as unknown as a device that doesn't exist.
    const theirs = await replay('device-2', asUser('user-1'));
    expect(theirs.errors?.[0]?.message).toBe('Unknown device');
    const [untouched] = await db.select().from(activities).where(eq(activities.id, 'act-theirs'));
    expect(untouched).toBeDefined();

    const mine = await replay('device-1', asUser('user-1'));
    expect(mine.errors).toBeUndefined();
    // No pings logged for it, so nothing to rebuild — and nothing lost.
    expect((mine.data as any).replayDevice).toEqual({ from: null, pings: 0, activities: 0 });
    expect(
      await db.select().from(activities).where(eq(activities.deviceId, 'device-1')),
    ).toHaveLength(2);

    const badFrom = await graphql({
      schema,
      source: 'mutation { replayDevice(id: "device-1", from: "yesterday") { pings } }',
      contextValue: asUser('user-1'),
    });
    expect(badFrom.errors?.[0]?.message).toBe('Invalid from');
  });
});
