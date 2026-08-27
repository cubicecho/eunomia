import { graphql } from 'graphql';
import { beforeEach, describe, expect, it } from 'vitest';
import { activities, categories, categoryRules, devices, user } from '../src/db/schema.ts';
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
    ({ db, userId: userId ?? undefined, deviceId: undefined, headers: new Headers() }) as Context;

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

    const me = await data('{ me }', null);
    expect(me.me).toBeNull();
  });
});
