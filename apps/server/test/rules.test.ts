import { graphql } from 'graphql';
import { beforeEach, describe, expect, it } from 'vitest';
import { activities, devices, user } from '../src/db/schema.ts';
import type { Context } from '../src/graphql/context.ts';
import { createSchema } from '../src/graphql/schema.ts';
import { stubAuthGateway } from './helpers/stub-auth.ts';
import { createMigratedTestDb } from './helpers/test-db.ts';

describe('auto-categorization rules', () => {
  let db: Awaited<ReturnType<typeof createMigratedTestDb>>;
  let schema: ReturnType<typeof createSchema>;

  const asUser = (userId: string): Context =>
    ({ db, userId, deviceId: 'device-1', keyId: undefined, headers: new Headers() }) as Context;

  const run = (source: string, userId = 'user-1') =>
    graphql({ schema, source, contextValue: asUser(userId) });

  const data = async (source: string, userId = 'user-1') => {
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
    await db
      .insert(devices)
      .values({ id: 'device-1', userId: 'user-1', name: 'laptop', platform: 'linux' });
  });

  const createCategory = async (name: string, userId = 'user-1') =>
    (await data(`mutation { createCategory(name: "${name}") { id } }`, userId)).createCategory
      .id as string;

  const createRule = async (
    categoryId: string,
    opts: { app?: string; title?: string; priority?: number } = {},
  ) => {
    const args = [
      `categoryId: "${categoryId}"`,
      opts.app !== undefined ? `appPattern: "${opts.app}"` : null,
      opts.title !== undefined ? `titlePattern: "${opts.title}"` : null,
      opts.priority !== undefined ? `priority: ${opts.priority}` : null,
    ]
      .filter(Boolean)
      .join(', ');
    return (await data(`mutation { createCategoryRule(${args}) { id } }`)).createCategoryRule
      .id as string;
  };

  const ping = (secondsAfterNoon: number, app: string, title?: string) =>
    data(`mutation { recordPing(
      capturedAt: "2026-08-17T12:00:${String(secondsAfterNoon).padStart(2, '0')}.000Z",
      app: "${app}", ${title !== undefined ? `title: "${title}",` : ''} idleSeconds: 0
    ) { id categoryId categorySource } }`);

  it('categorizes new activities by app pattern', async () => {
    const work = await createCategory('Work');
    await createRule(work, { app: '^code$' });

    const { recordPing } = await ping(0, 'code');
    expect(recordPing.categoryId).toBe(work);
    expect(recordPing.categorySource).toBe('rule');

    const { recordPing: other } = await ping(10, 'firefox');
    expect(other.categoryId).toBeNull();
  });

  it('re-evaluates on title churn for title rules', async () => {
    const gaming = await createCategory('Gaming');
    await createRule(gaming, { app: 'firefox', title: 'youtube' });

    const { recordPing: before } = await ping(0, 'firefox', 'news');
    expect(before.categoryId).toBeNull();

    const { recordPing: after } = await ping(10, 'firefox', 'YouTube - cat videos');
    expect(after.categoryId).toBe(gaming);

    // Title churns away again -> assignment clears (still rule-sourced).
    const { recordPing: away } = await ping(20, 'firefox', 'news again');
    expect(away.categoryId).toBeNull();
  });

  it('never overwrites a manual assignment', async () => {
    const work = await createCategory('Work');
    const personal = await createCategory('Personal');
    await createRule(work, { app: 'code' });

    const { recordPing: auto } = await ping(0, 'code');
    expect(auto.categoryId).toBe(work);

    await data(
      `mutation { assignActivity(activityId: "${auto.id}", categoryId: "${personal}") { id } }`,
    );
    const { recordPing: later } = await ping(10, 'code');
    expect(later.categoryId).toBe(personal);
    expect(later.categorySource).toBe('manual');
  });

  it('clears rule-made assignments after the rule is deleted', async () => {
    const work = await createCategory('Work');
    const ruleId = await createRule(work, { app: 'code' });

    const { recordPing: auto } = await ping(0, 'code');
    expect(auto.categoryId).toBe(work);

    await data(`mutation { deleteCategoryRule(id: "${ruleId}") }`);
    const { recordPing: after } = await ping(10, 'code');
    expect(after.categoryId).toBeNull();
    expect(after.categorySource).toBeNull();
  });

  it('first match wins by priority', async () => {
    const work = await createCategory('Work');
    const dev = await createCategory('Dev');
    await createRule(work, { app: 'co', priority: 10 });
    await createRule(dev, { app: 'code', priority: 1 });

    const { recordPing } = await ping(0, 'code');
    expect(recordPing.categoryId).toBe(dev);
  });

  it('sweeps historical activities on demand, skipping manual ones', async () => {
    const work = await createCategory('Work');
    const personal = await createCategory('Personal');
    await db.insert(activities).values([
      {
        id: 'old-code',
        deviceId: 'device-1',
        app: 'code',
        startedAt: new Date('2026-08-10T09:00:00Z'),
        lastActiveAt: new Date('2026-08-10T10:00:00Z'),
        activeSeconds: 3600,
        closedAt: new Date('2026-08-10T10:00:00Z'),
      },
      {
        id: 'old-pinned',
        deviceId: 'device-1',
        app: 'code',
        startedAt: new Date('2026-08-11T09:00:00Z'),
        lastActiveAt: new Date('2026-08-11T10:00:00Z'),
        activeSeconds: 3600,
        closedAt: new Date('2026-08-11T10:00:00Z'),
        categoryId: personal,
        categorySource: 'manual' as const,
      },
    ]);
    await createRule(work, { app: 'code' });

    const { applyCategoryRules } = await data('mutation { applyCategoryRules }');
    expect(applyCategoryRules).toBe(1);

    const rows = await db.select().from(activities);
    expect(rows.find((r) => r.id === 'old-code')?.categoryId).toBe(work);
    expect(rows.find((r) => r.id === 'old-pinned')?.categoryId).toBe(personal);
  });

  it('sweeps more history than one page holds', async () => {
    // The sweep walks by id in pages, so the batch boundary is where a cursor
    // mistake would either skip rows or loop on the same page forever. 1200 is
    // over SWEEP_PAGE with a partial final page.
    const work = await createCategory('Work');
    const noon = Date.parse('2026-08-10T12:00:00Z');
    await db.insert(activities).values(
      Array.from({ length: 1200 }, (_, i) => ({
        id: `a${String(i).padStart(5, '0')}`,
        deviceId: 'device-1',
        // Half match the rule, so the sweep also has to leave rows alone.
        app: i % 2 === 0 ? 'code' : 'firefox',
        startedAt: new Date(noon + i * 1000),
        lastActiveAt: new Date(noon + i * 1000 + 60_000),
        activeSeconds: 60,
        closedAt: new Date(noon + i * 1000 + 60_000),
      })),
    );
    await createRule(work, { app: '^code$' });

    const { applyCategoryRules } = await data('mutation { applyCategoryRules }');
    expect(applyCategoryRules).toBe(600);

    const rows = await db.select().from(activities);
    expect(rows.filter((r) => r.categoryId === work)).toHaveLength(600);
    expect(rows.filter((r) => r.app === 'firefox' && r.categoryId !== null)).toEqual([]);

    // And it converges: a second sweep finds nothing left to move.
    expect((await data('mutation { applyCategoryRules }')).applyCategoryRules).toBe(0);
  });

  it('edits a rule in place: new pattern applies, cleared fields stop matching', async () => {
    const work = await createCategory('Work');
    const dev = await createCategory('Dev');
    const ruleId = await createRule(work, { app: 'firefox', title: 'youtube' });

    const { recordPing: before } = await ping(0, 'firefox', 'YouTube - cats');
    expect(before.categoryId).toBe(work);

    // Same rule, different category, and the title condition dropped.
    const { updateCategoryRule } = await data(`mutation { updateCategoryRule(
      id: "${ruleId}", categoryId: "${dev}", appPattern: "firefox", priority: 3
    ) { id categoryId appPattern titlePattern priority } }`);
    expect(updateCategoryRule).toMatchObject({
      id: ruleId,
      categoryId: dev,
      appPattern: 'firefox',
      titlePattern: null,
      priority: 3,
    });

    const { recordPing: after } = await ping(10, 'firefox', 'news');
    expect(after.categoryId).toBe(dev);
  });

  it('rejects edits that empty a rule, break a regex, or reach across users', async () => {
    const mine = await createCategory('Work');
    const theirs = await createCategory('Their', 'user-2');
    const ruleId = await createRule(mine, { app: 'code' });

    const none = await run(
      `mutation { updateCategoryRule(id: "${ruleId}", categoryId: "${mine}") { id } }`,
    );
    expect(none.errors?.[0]?.message).toContain('needs an appPattern');

    const bad = await run(
      `mutation { updateCategoryRule(id: "${ruleId}", categoryId: "${mine}", appPattern: "([") { id } }`,
    );
    expect(bad.errors?.[0]?.message).toContain('Invalid pattern');

    const foreignCategory = await run(
      `mutation { updateCategoryRule(id: "${ruleId}", categoryId: "${theirs}", appPattern: "code") { id } }`,
    );
    expect(foreignCategory.errors?.[0]?.message).toBe('Unknown category');

    const foreignRule = await run(
      `mutation { updateCategoryRule(id: "${ruleId}", categoryId: "${theirs}", appPattern: "code") { id } }`,
      'user-2',
    );
    expect(foreignRule.errors?.[0]?.message).toBe('Unknown rule');
  });

  it('rejects rules with no pattern, bad regexes, and foreign categories', async () => {
    const mine = await createCategory('Work');
    const theirs = await createCategory('Their', 'user-2');

    const none = await run(`mutation { createCategoryRule(categoryId: "${mine}") { id } }`);
    expect(none.errors?.[0]?.message).toContain('needs an appPattern');

    const bad = await run(
      `mutation { createCategoryRule(categoryId: "${mine}", appPattern: "([") { id } }`,
    );
    expect(bad.errors?.[0]?.message).toContain('Invalid pattern');

    const foreign = await run(
      `mutation { createCategoryRule(categoryId: "${theirs}", appPattern: "code") { id } }`,
    );
    expect(foreign.errors?.[0]?.message).toBe('Unknown category');
  });
});
