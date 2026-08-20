import { sql } from 'drizzle-orm';
import { graphql } from 'graphql';
import { beforeEach, describe, expect, it } from 'vitest';
import { rollupActivities } from '../src/activity/rollup.ts';
import { activities, categories, categoryRules, devices, summaries, user } from '../src/db/schema.ts';
import type { Context } from '../src/graphql/context.ts';
import { createSchema } from '../src/graphql/schema.ts';
import { stubAuthGateway } from './helpers/stub-auth.ts';
import { createMigratedTestDb } from './helpers/test-db.ts';

describe('rollup', () => {
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
    startedAt: string,
    activeSeconds: number,
    opts: {
      app?: string;
      context?: string | null;
      categoryId?: string | null;
      open?: boolean;
      title?: string;
    } = {},
  ) => ({
    id,
    deviceId: 'device-1',
    app: opts.app ?? 'code',
    context: opts.context ?? null,
    title: opts.title ?? null,
    startedAt: new Date(startedAt),
    lastActiveAt: new Date(startedAt),
    activeSeconds,
    closedAt: opts.open ? null : new Date(startedAt),
    categoryId: opts.categoryId ?? null,
    categorySource: opts.categoryId ? ('manual' as const) : null,
  });

  beforeEach(async () => {
    db = await createMigratedTestDb();
    schema = createSchema(db as never, stubAuthGateway());
    await db.insert(user).values({ id: 'user-1', name: 'u', email: 'u@example.com' });
    await db.insert(devices).values({
      id: 'device-1',
      userId: 'user-1',
      name: 'laptop',
      platform: 'linux',
    });
    await db.insert(categories).values({ id: 'work', userId: 'user-1', name: 'Work' });
  });

  it('folds closed activities into summaries idempotently', async () => {
    await db.insert(activities).values([
      // Same (device, day, app, context, category) — must merge into one row.
      activity('a1', '2026-08-10T09:00:00Z', 600, { categoryId: 'work' }),
      activity('a2', '2026-08-10T14:00:00Z', 300, { categoryId: 'work' }),
      // Distinct context and day.
      activity('a3', '2026-08-10T10:00:00Z', 120, { app: 'firefox', context: 'github.com' }),
      activity('a4', '2026-08-11T09:00:00Z', 60),
      // Open: not rolled yet.
      activity('a5', '2026-08-11T10:00:00Z', 42, { open: true }),
    ]);

    expect(await rollupActivities(db as never)).toBe(4);
    const rows = await db.select().from(summaries).orderBy(summaries.day, summaries.app);
    expect(rows.map(({ day, app, context, categoryId, seconds }) => ({ day, app, context, categoryId, seconds }))).toEqual([
      { day: '2026-08-10', app: 'code', context: null, categoryId: 'work', seconds: 900 },
      { day: '2026-08-10', app: 'firefox', context: 'github.com', categoryId: null, seconds: 120 },
      { day: '2026-08-11', app: 'code', context: null, categoryId: null, seconds: 60 },
    ]);

    // Nothing new to roll — running again must not double-count.
    expect(await rollupActivities(db as never)).toBe(0);
    expect(await db.select().from(summaries).then((r) => r.length)).toBe(3);

    // A later close rolls incrementally into the existing row.
    await db.insert(activities).values([activity('a6', '2026-08-11T12:00:00Z', 40)]);
    expect(await rollupActivities(db as never)).toBe(1);
    const after = await db.select().from(summaries);
    expect(after.find((r) => r.day === '2026-08-11')?.seconds).toBe(100);
  });

  it('buckets days in the session time zone', async () => {
    // 02:00 UTC on the 11th is still the evening of the 10th in Chicago —
    // prod sets the zone via the TZ env (see db/client.ts).
    await db.execute(sql`set time zone 'America/Chicago'`);
    try {
      await db.insert(activities).values([activity('a1', '2026-08-11T02:00:00Z', 600)]);
      await rollupActivities(db as never);
      const rows = await db.select().from(summaries);
      expect(rows.map((r) => r.day)).toEqual(['2026-08-10']);
    } finally {
      await db.execute(sql`set time zone 'UTC'`);
    }
  });

  it('categorySummary and appSummary merge rolled and live time', async () => {
    await db.insert(activities).values([
      activity('a1', '2026-08-10T09:00:00Z', 600, { categoryId: 'work' }),
      activity('a2', '2026-08-10T10:00:00Z', 120, { app: 'firefox', context: 'github.com' }),
    ]);
    const query = `{
      categorySummary(from: "2026-08-10T00:00:00Z", to: "2026-08-12T00:00:00Z") {
        day categoryId seconds
      }
      appSummary(from: "2026-08-10T00:00:00Z", to: "2026-08-12T00:00:00Z") {
        app context seconds
      }
    }`;

    const before = await run(query);
    expect(before.errors).toBeUndefined();

    await rollupActivities(db as never);
    // Live, un-rolled time lands on top of the rolled rows.
    await db.insert(activities).values([
      activity('a3', '2026-08-10T20:00:00Z', 300, { categoryId: 'work', open: true }),
    ]);

    const result = await run(query);
    expect(result.errors).toBeUndefined();
    expect((result.data as any).categorySummary).toEqual([
      { day: '2026-08-10', categoryId: 'work', seconds: 900 },
      { day: '2026-08-10', categoryId: null, seconds: 120 },
    ]);
    expect((result.data as any).appSummary).toEqual([
      { app: 'code', context: null, seconds: 900 },
      { app: 'firefox', context: 'github.com', seconds: 120 },
    ]);
    // Pre-rollup and post-rollup agree except for the extra live activity.
    expect((before.data as any).categorySummary[0].seconds).toBe(600);
  });

  it('assignActivity on a rolled activity moves its summary seconds', async () => {
    await db.insert(activities).values([activity('a1', '2026-08-10T09:00:00Z', 600)]);
    await rollupActivities(db as never);

    const result = await run(
      'mutation { assignActivity(activityId: "a1", categoryId: "work") { id } }',
    );
    expect(result.errors).toBeUndefined();

    const rows = await db.select().from(summaries);
    expect(rows.filter((r) => r.seconds > 0)).toEqual([
      expect.objectContaining({ categoryId: 'work', seconds: 600 }),
    ]);
  });

  it('a rule sweep over rolled activities moves their summary seconds', async () => {
    await db.insert(activities).values([activity('a1', '2026-08-10T09:00:00Z', 600)]);
    await rollupActivities(db as never);
    await db.insert(categoryRules).values({
      id: 'rule-1',
      userId: 'user-1',
      categoryId: 'work',
      appPattern: '^code$',
    });

    const result = await run('mutation { applyCategoryRules }');
    expect(result.errors).toBeUndefined();
    expect((result.data as any).applyCategoryRules).toBe(1);

    const rows = await db.select().from(summaries);
    expect(rows.filter((r) => r.seconds > 0)).toEqual([
      expect.objectContaining({ categoryId: 'work', seconds: 600 }),
    ]);
  });

  it('deleteCategory merges its summary rows into uncategorized', async () => {
    await db.insert(activities).values([
      activity('a1', '2026-08-10T09:00:00Z', 600, { categoryId: 'work' }),
      activity('a2', '2026-08-10T10:00:00Z', 100),
    ]);
    await rollupActivities(db as never);

    const result = await run('mutation { deleteCategory(id: "work") }');
    expect(result.errors).toBeUndefined();

    const rows = await db.select().from(summaries);
    expect(rows).toEqual([expect.objectContaining({ categoryId: null, seconds: 700 })]);
  });
});
