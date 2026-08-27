import { graphql } from 'graphql';
import { beforeEach, describe, expect, it } from 'vitest';
import { activities, categories, devices, summaries, user } from '../src/db/schema.ts';
import type { Context } from '../src/graphql/context.ts';
import { createSchema } from '../src/graphql/schema.ts';
import { stubAuthGateway } from './helpers/stub-auth.ts';
import { createMigratedTestDb } from './helpers/test-db.ts';

describe('categorySummary', () => {
  let db: Awaited<ReturnType<typeof createMigratedTestDb>>;
  let schema: ReturnType<typeof createSchema>;

  const run = (source: string, userId = 'user-1') =>
    graphql({
      schema,
      source,
      contextValue: { db, userId, deviceId: undefined, headers: new Headers() } as Context,
    });

  const activity = (
    id: string,
    deviceId: string,
    startedAt: string,
    activeSeconds: number,
    categoryId: string | null = null,
  ) => ({
    id,
    deviceId,
    app: 'code',
    startedAt: new Date(startedAt),
    lastActiveAt: new Date(startedAt),
    activeSeconds,
    categoryId,
    categorySource: categoryId ? ('manual' as const) : null,
  });

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
      { id: 'work', userId: 'user-1', name: 'Work', color: '#3fb950' },
      { id: 'their-cat', userId: 'user-2', name: 'Theirs' },
    ]);
    await db.insert(activities).values([
      // user-1, day one: two Work activities + one uncategorized.
      activity('a1', 'device-1', '2026-08-10T09:00:00Z', 600, 'work'),
      activity('a2', 'device-1', '2026-08-10T14:00:00Z', 300, 'work'),
      activity('a3', 'device-1', '2026-08-10T20:00:00Z', 120),
      // user-1, day two.
      activity('a4', 'device-1', '2026-08-11T09:00:00Z', 900, 'work'),
      // outside the queried window.
      activity('a5', 'device-1', '2026-08-13T09:00:00Z', 999, 'work'),
      // another user's time, same window.
      activity('b1', 'device-2', '2026-08-10T09:00:00Z', 5000, 'their-cat'),
    ]);
  });

  const query = `{
    categorySummary(from: "2026-08-10T00:00:00Z", to: "2026-08-12T00:00:00Z") {
      day categoryId name color seconds
    }
  }`;

  it('sums active seconds per category per day for the caller only', async () => {
    const result = await run(query);
    expect(result.errors).toBeUndefined();
    // Ordered by day, then categoryId with SQL nulls (uncategorized) last.
    expect((result.data as any).categorySummary).toEqual([
      { day: '2026-08-10', categoryId: 'work', name: 'Work', color: '#3fb950', seconds: 900 },
      { day: '2026-08-10', categoryId: null, name: null, color: null, seconds: 120 },
      { day: '2026-08-11', categoryId: 'work', name: 'Work', color: '#3fb950', seconds: 900 },
    ]);
  });

  it('scopes to the other caller symmetrically', async () => {
    const result = await run(query, 'user-2');
    expect(result.errors).toBeUndefined();
    expect((result.data as any).categorySummary).toEqual([
      { day: '2026-08-10', categoryId: 'their-cat', name: 'Theirs', color: null, seconds: 5000 },
    ]);
  });

  it('rejects invalid date ranges', async () => {
    const result = await run('{ categorySummary(from: "nope", to: "2026-08-12") { day } }');
    expect(result.errors?.[0]?.message).toBe('Invalid date range');
  });
});

describe('per-device summaries', () => {
  let db: Awaited<ReturnType<typeof createMigratedTestDb>>;
  let schema: ReturnType<typeof createSchema>;

  const run = (source: string, userId = 'user-1') =>
    graphql({
      schema,
      source,
      contextValue: { db, userId, deviceId: undefined, headers: new Headers() } as Context,
    });

  const RANGE = 'from: "2026-08-10T00:00:00Z", to: "2026-08-12T00:00:00Z"';

  beforeEach(async () => {
    db = await createMigratedTestDb();
    schema = createSchema(db as never, stubAuthGateway());
    await db.insert(user).values([
      { id: 'user-1', name: 'u', email: 'u@example.com' },
      { id: 'user-2', name: 'v', email: 'v@example.com' },
    ]);
    await db.insert(devices).values([
      { id: 'laptop', userId: 'user-1', name: 'laptop', platform: 'linux' },
      { id: 'phone', userId: 'user-1', name: 'phone', platform: 'android' },
      { id: 'theirs', userId: 'user-2', name: 'desktop', platform: 'windows' },
    ]);
    await db.insert(activities).values([
      {
        id: 'a1',
        deviceId: 'laptop',
        app: 'code',
        startedAt: new Date('2026-08-10T09:00:00Z'),
        lastActiveAt: new Date('2026-08-10T09:00:00Z'),
        activeSeconds: 600,
      },
      {
        id: 'a2',
        deviceId: 'phone',
        app: 'Instagram',
        startedAt: new Date('2026-08-10T20:00:00Z'),
        lastActiveAt: new Date('2026-08-10T20:00:00Z'),
        activeSeconds: 300,
      },
      // Already rolled up: counted once, via the summaries row below.
      {
        id: 'a3',
        deviceId: 'laptop',
        app: 'code',
        startedAt: new Date('2026-08-11T09:00:00Z'),
        lastActiveAt: new Date('2026-08-11T09:00:00Z'),
        activeSeconds: 120,
        rolledUp: true,
      },
      {
        id: 'b1',
        deviceId: 'theirs',
        app: 'code',
        startedAt: new Date('2026-08-10T09:00:00Z'),
        lastActiveAt: new Date('2026-08-10T09:00:00Z'),
        activeSeconds: 5000,
      },
    ]);
    await db
      .insert(summaries)
      .values([{ id: 's1', deviceId: 'laptop', day: '2026-08-11', app: 'code', seconds: 120 }]);
  });

  it('totals both halves per device, busiest first, for the caller only', async () => {
    const result = await run(`{ deviceSummary(${RANGE}) { deviceId name platform seconds } }`);
    expect(result.errors).toBeUndefined();
    expect((result.data as any).deviceSummary).toEqual([
      { deviceId: 'laptop', name: 'laptop', platform: 'linux', seconds: 720 },
      { deviceId: 'phone', name: 'phone', platform: 'android', seconds: 300 },
    ]);
  });

  it('narrows appSummary to one device, rolled and live alike', async () => {
    const all = await run(`{ appSummary(${RANGE}) { app seconds } }`);
    expect((all.data as any).appSummary).toEqual([
      { app: 'code', seconds: 720 },
      { app: 'Instagram', seconds: 300 },
    ]);

    const phone = await run(`{ appSummary(${RANGE}, deviceId: "phone") { app seconds } }`);
    expect(phone.errors).toBeUndefined();
    expect((phone.data as any).appSummary).toEqual([{ app: 'Instagram', seconds: 300 }]);
  });

  it('narrows categorySummary to one device', async () => {
    const result = await run(`{ categorySummary(${RANGE}, deviceId: "laptop") { day seconds } }`);
    expect(result.errors).toBeUndefined();
    expect((result.data as any).categorySummary).toEqual([
      { day: '2026-08-10', seconds: 600 },
      { day: '2026-08-11', seconds: 120 },
    ]);
  });

  it("shows nothing for another user's device rather than their time", async () => {
    const result = await run(`{ appSummary(${RANGE}, deviceId: "theirs") { app seconds } }`);
    expect(result.errors).toBeUndefined();
    expect((result.data as any).appSummary).toEqual([]);
  });
});
