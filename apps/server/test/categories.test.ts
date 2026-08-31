import { eq } from 'drizzle-orm';
import { graphql } from 'graphql';
import { beforeEach, describe, expect, it } from 'vitest';
import { activities, categories, devices, user } from '../src/db/schema.ts';
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

  it("refuses to delete another user's category", async () => {
    const category = await createCategory();
    const result = await run(`mutation { deleteCategory(id: "${category.id}") }`, 'user-2');
    expect(result.errors?.[0]?.message).toBe('Unknown category');
  });
});
