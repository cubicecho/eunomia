import { eq } from 'drizzle-orm';
import { graphql } from 'graphql';
import { beforeEach, describe, expect, it } from 'vitest';
import { pruneActivities, rollupActivities } from '../src/activity/rollup.ts';
import {
  activities,
  categories,
  categoryRules,
  devices,
  summaries,
  user,
} from '../src/db/schema.ts';
import type { Context } from '../src/graphql/context.ts';
import { createSchema } from '../src/graphql/schema.ts';
import { stubAuthGateway } from './helpers/stub-auth.ts';
import { createMigratedTestDb } from './helpers/test-db.ts';

describe('categories', () => {
  let db: Awaited<ReturnType<typeof createMigratedTestDb>>;
  let schema: ReturnType<typeof createSchema>;

  const asUser = (userId: string): Context =>
    ({ db, userId, deviceId: undefined, keyId: undefined, headers: new Headers() }) as Context;

  const run = (source: string, userId = 'user-1') =>
    graphql({ schema, source, contextValue: asUser(userId) });

  beforeEach(async () => {
    db = await createMigratedTestDb();
    schema = createSchema(db as never, stubAuthGateway());
    await db.insert(user).values([
      { id: 'user-1', name: 'u', email: 'u@example.com' },
      { id: 'user-2', name: 'v', email: 'v@example.com' },
    ]);
    await db
      .insert(devices)
      .values({ id: 'device-1', userId: 'user-1', name: 'laptop', platform: 'linux' });
    await db.insert(activities).values({
      id: 'activity-1',
      deviceId: 'device-1',
      app: 'code',
      startedAt: new Date('2026-08-17T12:00:00Z'),
      lastActiveAt: new Date('2026-08-17T12:10:00Z'),
      activeSeconds: 600,
    });
  });

  const createCategory = async (userId = 'user-1') => {
    const result = await run(
      `mutation { createCategory(name: "Work", color: "#3fb950") { id name color userId } }`,
      userId,
    );
    expect(result.errors).toBeUndefined();
    return (result.data as any).createCategory;
  };

  it('creates a category owned by the caller', async () => {
    const category = await createCategory();
    expect(category.name).toBe('Work');
    expect(category.color).toBe('#3fb950');
    expect(category.userId).toBe('user-1');
  });

  it('assigns and unassigns an activity', async () => {
    const category = await createCategory();

    const assigned = await run(
      `mutation { assignActivity(activityId: "activity-1", categoryId: "${category.id}") { id categoryId } }`,
    );
    expect(assigned.errors).toBeUndefined();
    expect((assigned.data as any).assignActivity.categoryId).toBe(category.id);

    const cleared = await run(
      `mutation { assignActivity(activityId: "activity-1") { id categoryId } }`,
    );
    expect(cleared.errors).toBeUndefined();
    expect((cleared.data as any).assignActivity.categoryId).toBeNull();
  });

  it('serves assigned activities through the category relation', async () => {
    const category = await createCategory();
    await run(
      `mutation { assignActivity(activityId: "activity-1", categoryId: "${category.id}") { id } }`,
    );

    const result = await run('{ categories { id name activities { id app } } }');
    expect(result.errors).toBeUndefined();
    const [row] = (result.data as any).categories;
    expect(row.activities).toEqual([{ id: 'activity-1', app: 'code' }]);
  });

  it("refuses to assign another user's activity or category", async () => {
    const theirs = await createCategory('user-2');

    const wrongActivity = await run(
      `mutation { assignActivity(activityId: "activity-1", categoryId: "${theirs.id}") { id } }`,
    );
    expect(wrongActivity.errors?.[0]?.message).toBe('Unknown category');

    const wrongOwner = await run(
      `mutation { assignActivity(activityId: "activity-1") { id } }`,
      'user-2',
    );
    expect(wrongOwner.errors?.[0]?.message).toBe('Unknown activity');
  });

  it('deleting a category unassigns its activities without deleting them', async () => {
    const category = await createCategory();
    await run(
      `mutation { assignActivity(activityId: "activity-1", categoryId: "${category.id}") { id } }`,
    );

    const deleted = await run(`mutation { deleteCategory(id: "${category.id}") }`);
    expect(deleted.errors).toBeUndefined();
    expect((deleted.data as any).deleteCategory).toBe(true);

    const [activity] = await db.select().from(activities).where(eq(activities.id, 'activity-1'));
    expect(activity!.categoryId).toBeNull();
    expect(await db.select().from(categories)).toHaveLength(0);
  });

  it('renames and recolors a category, and clears its color', async () => {
    const category = await createCategory();

    const updated = await run(
      `mutation { updateCategory(id: "${category.id}", name: "  Deep work ", color: "#d95926") { id name color } }`,
    );
    expect(updated.errors).toBeUndefined();
    expect((updated.data as any).updateCategory).toEqual({
      id: category.id,
      name: 'Deep work',
      color: '#d95926',
    });

    // A whole replacement: leaving color out means no color, as with rules.
    const cleared = await run(
      `mutation { updateCategory(id: "${category.id}", name: "Deep work") { color } }`,
    );
    expect(cleared.errors).toBeUndefined();
    expect((cleared.data as any).updateCategory.color).toBeNull();
  });

  it('gives a category a kind, neutral unless told otherwise', async () => {
    const created = await run(
      'mutation { a: createCategory(name: "Code", kind: focus) { id kind } b: createCategory(name: "Misc") { kind } }',
    );
    expect(created.errors).toBeUndefined();
    const { a, b } = created.data as any;
    expect([a.kind, b.kind]).toEqual(['focus', 'neutral']);

    const updated = await run(
      `mutation { updateCategory(id: "${a.id}", name: "Code", kind: distracting) { kind } }`,
    );
    expect((updated.data as any).updateCategory.kind).toBe('distracting');
    // A whole replacement, like color: no kind is neutral again.
    const reset = await run(`mutation { updateCategory(id: "${a.id}", name: "Code") { kind } }`);
    expect((reset.data as any).updateCategory.kind).toBe('neutral');

    const bogus = await run('mutation { createCategory(name: "X", kind: fun) { id } }');
    expect(bogus.errors?.length).toBeGreaterThan(0);
  });

  it('refuses a blank or duplicate name, on create and rename alike', async () => {
    const work = await createCategory();
    const play = await run('mutation { createCategory(name: "Play") { id } }');
    const playId = (play.data as any).createCategory.id;

    for (const source of [
      'mutation { createCategory(name: "   ") { id } }',
      'mutation { createCategory(name: " Work ") { id } }',
      `mutation { updateCategory(id: "${playId}", name: "") { id } }`,
      `mutation { updateCategory(id: "${playId}", name: "Work") { id } }`,
    ]) {
      const result = await run(source);
      expect(result.errors?.[0]?.extensions?.code).toBe('BAD_USER_INPUT');
    }

    // Keeping its own name is not a clash, and neither is another user's.
    const same = await run(`mutation { updateCategory(id: "${work.id}", name: "Work") { id } }`);
    expect(same.errors).toBeUndefined();
    await createCategory('user-2');
  });

  it("refuses to update another user's category", async () => {
    const category = await createCategory();
    const result = await run(
      `mutation { updateCategory(id: "${category.id}", name: "Mine") { id } }`,
      'user-2',
    );
    expect(result.errors?.[0]?.message).toBe('Unknown category');
    const [row] = await db.select().from(categories).where(eq(categories.id, category.id));
    expect(row!.name).toBe('Work');
  });

  it("refuses to delete another user's category", async () => {
    const category = await createCategory();
    const result = await run(`mutation { deleteCategory(id: "${category.id}") }`, 'user-2');
    expect(result.errors?.[0]?.message).toBe('Unknown category');
  });
});

describe('assignEntry', () => {
  let db: Awaited<ReturnType<typeof createMigratedTestDb>>;
  let schema: ReturnType<typeof createSchema>;

  const run = (source: string, userId = 'user-1') =>
    graphql({
      schema,
      source,
      contextValue: {
        db,
        userId,
        deviceId: undefined,
        keyId: undefined,
        headers: new Headers(),
      } as Context,
    });

  const activity = (
    id: string,
    startedAt: string,
    activeSeconds: number,
    opts: { deviceId?: string; context?: string; categoryId?: string; open?: boolean } = {},
  ) => ({
    id,
    deviceId: opts.deviceId ?? 'device-1',
    app: 'firefox',
    context: opts.context ?? null,
    startedAt: new Date(startedAt),
    lastActiveAt: new Date(startedAt),
    activeSeconds,
    closedAt: opts.open ? null : new Date(startedAt),
    categoryId: opts.categoryId ?? null,
    categorySource: opts.categoryId ? ('rule' as const) : null,
  });

  /** firefox's contextless entry into Work over Aug 10–11, plus `extra` arguments. */
  const assign = (extra = '', userId = 'user-1') =>
    run(
      `mutation { assignEntry(app: "firefox", categoryId: "work", from: "2026-08-10", to: "2026-08-12"${extra}) }`,
      userId,
    );

  const uncategorized = async (userId = 'user-1') => {
    const result = await run(
      '{ appSummary(from: "2026-08-01", to: "2026-09-01") { app context categoryId seconds } }',
      userId,
    );
    expect(result.errors).toBeUndefined();
    return (result.data as any).appSummary.filter((row: any) => row.categoryId === null);
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
      { id: 'work', userId: 'user-1', name: 'Work' },
      { id: 'play', userId: 'user-1', name: 'Play' },
      { id: 'theirs', userId: 'user-2', name: 'Theirs' },
    ]);
  });

  it('assigns the entry’s uncategorized time in the window, rolled and live', async () => {
    await db.insert(activities).values([activity('rolled', '2026-08-10T09:00:00Z', 600)]);
    await rollupActivities(db as never);
    await db
      .insert(activities)
      .values([activity('live', '2026-08-11T09:00:00Z', 300, { open: true })]);

    const result = await assign();
    expect(result.errors).toBeUndefined();
    expect((result.data as any).assignEntry).toBe(900);
    expect(await uncategorized()).toEqual([]);

    // The raw rows are pinned, and the rolled row's seconds moved exactly once.
    const rows = await db.select().from(activities);
    expect(rows.map((row) => [row.categoryId, row.categorySource])).toEqual([
      ['work', 'manual'],
      ['work', 'manual'],
    ]);
    expect(await db.select().from(summaries)).toEqual([
      expect.objectContaining({ categoryId: 'work', seconds: 600 }),
    ]);
  });

  it('leaves other entries, categorized time, and days outside the window alone', async () => {
    await db
      .insert(activities)
      .values([
        activity('target', '2026-08-10T09:00:00Z', 100),
        activity('site', '2026-08-10T10:00:00Z', 200, { context: 'github.com' }),
        activity('ruled', '2026-08-10T11:00:00Z', 400, { categoryId: 'play' }),
        activity('later', '2026-08-12T09:00:00Z', 800),
      ]);

    const result = await assign();
    expect((result.data as any).assignEntry).toBe(100);
    expect(await uncategorized()).toEqual([
      { app: 'firefox', context: null, categoryId: null, seconds: 800 },
      { app: 'firefox', context: 'github.com', categoryId: null, seconds: 200 },
    ]);
    const [ruled] = await db.select().from(activities).where(eq(activities.id, 'ruled'));
    expect(ruled!.categoryId).toBe('play');

    // A context names one entry inside the app.
    const site = await assign(', context: "github.com"');
    expect((site.data as any).assignEntry).toBe(200);
  });

  it('cuts the window at midnight in the user’s own time zone', async () => {
    await db.update(user).set({ timeZone: 'Asia/Tokyo' }).where(eq(user.id, 'user-1'));
    await db.insert(activities).values([
      // Aug 10 00:30 in Tokyo, though still Aug 9 in UTC: inside.
      activity('tokyo-morning', '2026-08-09T15:30:00Z', 100),
      // Aug 12 00:30 in Tokyo, though still Aug 11 in UTC: outside.
      activity('tokyo-next', '2026-08-11T15:30:00Z', 800),
    ]);

    const result = await assign();
    expect(result.errors).toBeUndefined();
    expect((result.data as any).assignEntry).toBe(100);
    const [outside] = await db.select().from(activities).where(eq(activities.id, 'tokyo-next'));
    expect(outside!.categoryId).toBeNull();
  });

  it('moves rolled time whose raw activities have been pruned', async () => {
    const longAgo = new Date(Date.now() - 100 * 86_400_000).toISOString();
    await db.insert(activities).values([activity('old', longAgo, 600)]);
    await rollupActivities(db as never);
    expect(await pruneActivities(db as never, 90)).toBe(1);

    const result = await run(
      'mutation { assignEntry(app: "firefox", categoryId: "work", from: "2000-01-01", to: "2100-01-01") }',
    );
    expect(result.errors).toBeUndefined();
    expect((result.data as any).assignEntry).toBe(600);
    expect(await db.select().from(summaries)).toEqual([
      expect.objectContaining({ categoryId: 'work', seconds: 600 }),
    ]);
  });

  it('is a manual assignment: a rule sweep does not take it back', async () => {
    await db.insert(activities).values([activity('a1', '2026-08-10T09:00:00Z', 600)]);
    await db
      .insert(categoryRules)
      .values({ id: 'rule-1', userId: 'user-1', categoryId: 'play', appPattern: '^firefox$' });
    await assign();

    const swept = await run('mutation { applyCategoryRules }');
    expect((swept.data as any).applyCategoryRules).toBe(0);
  });

  it('only reaches the caller’s own time and categories', async () => {
    await db
      .insert(activities)
      .values([
        activity('mine', '2026-08-10T09:00:00Z', 600),
        activity('theirs', '2026-08-10T09:00:00Z', 900, { deviceId: 'device-2' }),
      ]);

    const wrongCategory = await assign('', 'user-2');
    expect(wrongCategory.errors?.[0]?.message).toBe('Unknown category');

    const own = await run(
      'mutation { assignEntry(app: "firefox", categoryId: "theirs", from: "2026-08-10", to: "2026-08-12") }',
      'user-2',
    );
    expect((own.data as any).assignEntry).toBe(900);
    expect(await uncategorized('user-1')).toEqual([
      { app: 'firefox', context: null, categoryId: null, seconds: 600 },
    ]);
  });

  it('rejects an invalid window', async () => {
    const result = await run(
      'mutation { assignEntry(app: "firefox", categoryId: "work", from: "nope", to: "2026-08-12") }',
    );
    expect(result.errors?.[0]?.extensions?.code).toBe('BAD_USER_INPUT');
  });
});
