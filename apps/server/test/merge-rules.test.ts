import { eq } from 'drizzle-orm';
import { graphql } from 'graphql';
import { beforeEach, describe, expect, it } from 'vitest';
import { rollupActivities } from '../src/activity/rollup.ts';
import { activities, devices, summaries, user } from '../src/db/schema.ts';
import type { Context } from '../src/graphql/context.ts';
import { createSchema } from '../src/graphql/schema.ts';
import { stubAuthGateway } from './helpers/stub-auth.ts';
import { createMigratedTestDb } from './helpers/test-db.ts';

describe('merging entries', () => {
  let db: Awaited<ReturnType<typeof createMigratedTestDb>>;
  let schema: ReturnType<typeof createSchema>;

  const run = (source: string, userId = 'user-1') =>
    graphql({
      schema,
      source,
      contextValue: { db, userId, deviceId: 'device-1', headers: new Headers() } as Context,
    });

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
    await db.insert(devices).values([
      { id: 'device-1', userId: 'user-1', name: 'phone', platform: 'android' },
      { id: 'device-2', userId: 'user-2', name: 'theirs', platform: 'linux' },
    ]);
  });

  const merge = (from: string, to: string, contexts: { from?: string; to?: string } = {}) => {
    const args = [
      `fromApp: "${from}"`,
      contexts.from !== undefined ? `fromContext: "${contexts.from}"` : null,
      `toApp: "${to}"`,
      contexts.to !== undefined ? `toContext: "${contexts.to}"` : null,
    ]
      .filter(Boolean)
      .join(', ');
    return data(`mutation { createMergeRule(${args}) { id fromApp toApp } }`);
  };

  const ping = (secondsAfterNoon: number, app: string, context?: string) =>
    data(`mutation { recordPing(
      capturedAt: "2026-08-17T12:00:${String(secondsAfterNoon).padStart(2, '0')}.000Z",
      app: "${app}", ${context !== undefined ? `context: "${context}",` : ''} idleSeconds: 0
    ) { id app context } }`);

  const stored = () =>
    db
      .select({
        app: activities.app,
        context: activities.context,
        seconds: activities.activeSeconds,
      })
      .from(activities)
      .where(eq(activities.deviceId, 'device-1'));

  const rolled = () =>
    db
      .select({ app: summaries.app, context: summaries.context, seconds: summaries.seconds })
      .from(summaries)
      .where(eq(summaries.deviceId, 'device-1'));

  it('rewrites past activities under the merged name', async () => {
    await ping(0, 'com.instagram.android');
    await ping(10, 'com.instagram.android');

    await merge('com.instagram.android', 'Instagram');

    expect(await stored()).toEqual([{ app: 'Instagram', context: null, seconds: 10 }]);
  });

  it('folds new pings under the merged name too', async () => {
    await merge('com.instagram.android', 'Instagram');

    const { recordPing } = await ping(0, 'com.instagram.android');
    expect(recordPing.app).toBe('Instagram');
  });

  it('adds the merged seconds to an entry that already exists', async () => {
    await ping(0, 'Instagram');
    await ping(10, 'Instagram');
    await ping(20, 'com.instagram.android');
    await ping(30, 'com.instagram.android');
    // Both entries are open, and they are about to become one key.
    expect((await stored()).length).toBe(2);

    await merge('com.instagram.android', 'Instagram');
    await rollupActivities(db);

    expect(await rolled()).toEqual([{ app: 'Instagram', context: null, seconds: 20 }]);
  });

  it('closes the open activity it rewrites, so folding still has one row per key', async () => {
    await ping(0, 'Instagram');
    await ping(10, 'com.instagram.android');
    await merge('com.instagram.android', 'Instagram');

    const open = await db
      .select()
      .from(activities)
      .where(eq(activities.deviceId, 'device-1'))
      .then((rows) => rows.filter((row) => row.closedAt === null));
    expect(open).toHaveLength(1);
    expect(open[0]?.app).toBe('Instagram');
  });

  it('moves seconds that were already rolled up', async () => {
    await ping(0, 'chrome');
    await ping(10, 'chrome');
    await db.update(activities).set({ closedAt: new Date() });
    await rollupActivities(db);
    expect(await rolled()).toEqual([{ app: 'chrome', context: null, seconds: 10 }]);

    await merge('chrome', 'Google Chrome');

    expect(await rolled()).toEqual([{ app: 'Google Chrome', context: null, seconds: 10 }]);
  });

  it('merges one context into another, leaving the rest of the app alone', async () => {
    await ping(0, 'chrome', 'x.com');
    await ping(10, 'chrome', 'x.com');
    await ping(20, 'chrome', 'news.example');
    await ping(30, 'chrome', 'news.example');

    await merge('chrome', 'chrome', { from: 'x.com', to: 'twitter.com' });

    expect(
      (await stored()).sort((a, b) => (a.context ?? '').localeCompare(b.context ?? '')),
    ).toEqual([
      { app: 'chrome', context: 'news.example', seconds: 20 },
      { app: 'chrome', context: 'twitter.com', seconds: 10 },
    ]);
  });

  it('renaming an app carries its contexts across untouched', async () => {
    await ping(0, 'chrome', 'x.com');
    await ping(10, 'chrome', 'x.com');

    await merge('chrome', 'Google Chrome');

    expect(await stored()).toEqual([{ app: 'Google Chrome', context: 'x.com', seconds: 10 }]);
  });

  it('follows a chain of merges in one pass', async () => {
    await ping(0, 'a');
    await ping(10, 'a');
    await merge('a', 'b');
    await merge('b', 'c');

    expect(await stored()).toEqual([{ app: 'c', context: null, seconds: 10 }]);
    const { recordPing } = await ping(20, 'a');
    expect(recordPing.app).toBe('c');
  });

  it('chains a rename and a context merge, in either direction', async () => {
    await ping(0, 'chrome', 'x.com');
    await ping(10, 'chrome', 'x.com');
    // What the dashboard offers after the rename: the entry now reads
    // "Google Chrome / x.com", so that is the entry the second merge names.
    await merge('chrome', 'Google Chrome');
    await merge('Google Chrome', 'Google Chrome', { from: 'x.com', to: 'twitter.com' });

    expect(await stored()).toEqual([{ app: 'Google Chrome', context: 'twitter.com', seconds: 10 }]);
    // A ping still arriving under the pre-rename name walks both hops.
    const { recordPing } = await ping(20, 'chrome', 'x.com');
    expect(recordPing).toEqual({
      id: expect.any(String),
      app: 'Google Chrome',
      context: 'twitter.com',
    });
  });

  it('leaves other users alone', async () => {
    await db.insert(activities).values({
      id: 'theirs',
      deviceId: 'device-2',
      app: 'com.instagram.android',
      startedAt: new Date('2026-08-17T12:00:00Z'),
      lastActiveAt: new Date('2026-08-17T12:00:10Z'),
      activeSeconds: 10,
      closedAt: new Date('2026-08-17T12:00:10Z'),
    });

    await merge('com.instagram.android', 'Instagram');

    const [theirs] = await db.select().from(activities).where(eq(activities.id, 'theirs'));
    expect(theirs?.app).toBe('com.instagram.android');
  });

  it('refuses a merge that loops back on itself', async () => {
    await merge('a', 'b');
    const result = await run('mutation { createMergeRule(fromApp: "b", toApp: "a") { id } }');
    expect(result.errors?.[0]?.extensions?.code).toBe('BAD_USER_INPUT');
  });

  it('refuses a second merge of the same entry', async () => {
    await merge('a', 'b');
    const result = await run('mutation { createMergeRule(fromApp: "a", toApp: "c") { id } }');
    expect(result.errors?.[0]?.extensions?.code).toBe('BAD_USER_INPUT');
  });

  it('refuses a whole-app merge that also names a destination context', async () => {
    const result = await run(
      'mutation { createMergeRule(fromApp: "a", toApp: "b", toContext: "x") { id } }',
    );
    expect(result.errors?.[0]?.extensions?.code).toBe('BAD_USER_INPUT');
  });

  it('stops applying to new pings once deleted, and leaves merged history merged', async () => {
    await ping(0, 'com.instagram.android');
    await ping(10, 'com.instagram.android');
    const { createMergeRule } = await merge('com.instagram.android', 'Instagram');

    await data(`mutation { deleteMergeRule(id: "${createMergeRule.id}") }`);

    expect(await stored()).toEqual([{ app: 'Instagram', context: null, seconds: 10 }]);
    const { recordPing } = await ping(20, 'com.instagram.android');
    expect(recordPing.app).toBe('com.instagram.android');
  });

  it('re-applies on demand to activity that arrived later', async () => {
    await merge('com.instagram.android', 'Instagram');
    // A device that was offline when the merge was made, syncing its outbox
    // straight into the table.
    await db.insert(activities).values({
      id: 'late',
      deviceId: 'device-1',
      app: 'com.instagram.android',
      startedAt: new Date('2026-08-17T12:00:00Z'),
      lastActiveAt: new Date('2026-08-17T12:00:10Z'),
      activeSeconds: 10,
      closedAt: new Date('2026-08-17T12:00:10Z'),
    });

    const { applyMergeRules } = await data('mutation { applyMergeRules }');
    expect(applyMergeRules).toBe(1);
    expect(await stored()).toEqual([{ app: 'Instagram', context: null, seconds: 10 }]);
  });

  it('lists only the caller’s merges', async () => {
    await merge('a', 'b');
    const mine = await data('{ mergeRules { fromApp toApp } }');
    expect(mine.mergeRules).toEqual([{ fromApp: 'a', toApp: 'b' }]);
    const theirs = await data('{ mergeRules { fromApp } }', 'user-2');
    expect(theirs.mergeRules).toEqual([]);
  });
});
