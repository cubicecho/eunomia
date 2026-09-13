import { eq, sql } from 'drizzle-orm';
import { graphql } from 'graphql';
import { beforeEach, describe, expect, it } from 'vitest';
import { pruneActivities, rollupActivities } from '../src/activity/rollup.ts';
import { setUserTimeZone } from '../src/activity/time-zone.ts';
import { activities, categories, devices, summaries, user } from '../src/db/schema.ts';
import type { Context } from '../src/graphql/context.ts';
import { createSchema } from '../src/graphql/schema.ts';
import { stubAuthGateway } from './helpers/stub-auth.ts';
import { createMigratedTestDb } from './helpers/test-db.ts';

// Days split at the owning user's midnight, not the server's. The test
// database's session zone is UTC (helpers/test-db.ts), standing in for the
// server's TZ — the zone of a user who hasn't chosen one.
describe('per-user time zones', () => {
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
    opts: { deviceId?: string; categoryId?: string | null; open?: boolean } = {},
  ) => ({
    id,
    deviceId: opts.deviceId ?? 'device-1',
    app: 'code',
    context: null,
    title: null,
    startedAt: new Date(startedAt),
    lastActiveAt: new Date(startedAt),
    activeSeconds,
    closedAt: opts.open ? null : new Date(startedAt),
    categoryId: opts.categoryId ?? null,
    categorySource: opts.categoryId ? ('manual' as const) : null,
  });

  const days = async (deviceId = 'device-1') =>
    (
      await db
        .select({
          day: summaries.day,
          categoryId: summaries.categoryId,
          seconds: summaries.seconds,
        })
        .from(summaries)
        .where(eq(summaries.deviceId, deviceId))
        .orderBy(summaries.day, summaries.categoryId)
    ).map((r) => ({ ...r }));

  const setZone = (userId: string, timeZone: string | null) =>
    db.update(user).set({ timeZone }).where(eq(user.id, userId));

  beforeEach(async () => {
    db = await createMigratedTestDb();
    schema = createSchema(db as never, stubAuthGateway());
    await db.insert(user).values([
      { id: 'user-1', name: 'u', email: 'u@example.com' },
      { id: 'user-2', name: 'v', email: 'v@example.com' },
    ]);
    await db.insert(devices).values([
      { id: 'device-1', userId: 'user-1', name: 'laptop', platform: 'linux' },
      { id: 'device-2', userId: 'user-2', name: 'desktop', platform: 'linux' },
    ]);
    await db.insert(categories).values({ id: 'work', userId: 'user-1', name: 'Work' });
  });

  it("rolls each device's time into its owner's day", async () => {
    // 02:00 UTC on the 11th: the evening of the 10th in Chicago, still the
    // 11th for a user who follows the (UTC) server.
    await setZone('user-1', 'America/Chicago');
    await db
      .insert(activities)
      .values([
        activity('a1', '2026-08-11T02:00:00Z', 600),
        activity('b1', '2026-08-11T02:00:00Z', 60, { deviceId: 'device-2' }),
      ]);
    await rollupActivities(db as never);

    expect(await days('device-1')).toEqual([{ day: '2026-08-10', categoryId: null, seconds: 600 }]);
    expect(await days('device-2')).toEqual([{ day: '2026-08-11', categoryId: null, seconds: 60 }]);
  });

  it("reads a bare-date range in the caller's zone, live and rolled alike", async () => {
    await setZone('user-1', 'America/Chicago');
    await db.insert(activities).values([activity('a1', '2026-08-26T01:00:00Z', 3600)]);
    const query = `{
      categorySummary(from: "2026-08-25", to: "2026-08-26") { day seconds }
      appSummary(from: "2026-08-25", to: "2026-08-26") { app seconds }
      deviceSummary(from: "2026-08-25", to: "2026-08-26") { deviceId seconds }
    }`;
    const expected = {
      categorySummary: [{ day: '2026-08-25', seconds: 3600 }],
      appSummary: [{ app: 'code', seconds: 3600 }],
      deviceSummary: [{ deviceId: 'device-1', seconds: 3600 }],
    };

    const live = await run(query);
    expect(live.errors).toBeUndefined();
    expect(live.data).toEqual(expected);

    await rollupActivities(db as never);
    const rolled = await run(query);
    expect(rolled.errors).toBeUndefined();
    expect(rolled.data).toEqual(expected);

    // The same instant is the 26th in UTC, outside this window.
    await setUserTimeZone(db as never, 'user-1', null);
    const utc = await run(query);
    expect(utc.errors).toBeUndefined();
    expect((utc.data as any).appSummary).toEqual([]);
  });

  it('refuses a date that is not a date', async () => {
    const result = await run('{ appSummary(from: "2026-02-30", to: "2026-03-01") { app } }');
    expect(result.errors?.[0]?.extensions?.code).toBe('BAD_USER_INPUT');
  });

  it("re-buckets the rolled days on file when the zone changes, and only the caller's", async () => {
    await db.insert(activities).values([
      // Evening in Chicago, the next day in UTC: moves back a day.
      activity('late', '2026-08-11T02:00:00Z', 600, { categoryId: 'work' }),
      // Midday either way: stays.
      activity('noon', '2026-08-11T17:00:00Z', 300, { categoryId: 'work' }),
      // Still open — never summarized, so there is nothing to move.
      activity('open', '2026-08-12T03:00:00Z', 42, { open: true }),
      activity('other', '2026-08-11T02:00:00Z', 60, { deviceId: 'device-2' }),
    ]);
    await rollupActivities(db as never);
    expect(await days()).toEqual([{ day: '2026-08-11', categoryId: 'work', seconds: 900 }]);

    await setUserTimeZone(db as never, 'user-1', 'America/Chicago');
    expect(await days()).toEqual([
      { day: '2026-08-10', categoryId: 'work', seconds: 600 },
      { day: '2026-08-11', categoryId: 'work', seconds: 300 },
    ]);
    expect(await days('device-2')).toEqual([{ day: '2026-08-11', categoryId: null, seconds: 60 }]);

    // Rolled after the change: already in the new zone, not moved twice.
    await db
      .update(activities)
      .set({ closedAt: new Date('2026-08-12T03:00:00Z') })
      .where(eq(activities.id, 'open'));
    await rollupActivities(db as never);
    expect(await days()).toEqual([
      { day: '2026-08-10', categoryId: 'work', seconds: 600 },
      { day: '2026-08-11', categoryId: 'work', seconds: 300 },
      { day: '2026-08-11', categoryId: null, seconds: 42 },
    ]);

    // Across the date line, then back to the server's zone: every row is where
    // a fresh rollup in that zone would put it, and emptied days are gone.
    await setUserTimeZone(db as never, 'user-1', 'Pacific/Kiritimati');
    expect(await days()).toEqual([
      { day: '2026-08-11', categoryId: 'work', seconds: 600 },
      { day: '2026-08-12', categoryId: 'work', seconds: 300 },
      { day: '2026-08-12', categoryId: null, seconds: 42 },
    ]);
    await setUserTimeZone(db as never, 'user-1', null);
    expect(await days()).toEqual([
      { day: '2026-08-11', categoryId: 'work', seconds: 900 },
      { day: '2026-08-12', categoryId: null, seconds: 42 },
    ]);
  });

  it('leaves summaries of pruned activities on the day they were bucketed', async () => {
    const at = new Date(Date.now() - 100 * 86_400_000);
    at.setUTCHours(2, 0, 0, 0);
    const recent = new Date(Date.now() - 5 * 86_400_000);
    recent.setUTCHours(2, 0, 0, 0);
    await db
      .insert(activities)
      .values([
        activity('old', at.toISOString(), 600),
        activity('recent', recent.toISOString(), 300),
      ]);
    await rollupActivities(db as never);
    expect(await pruneActivities(db as never, 90)).toBe(1);
    const utcDay = (d: Date) => d.toISOString().slice(0, 10);
    const dayBefore = (d: Date) => utcDay(new Date(d.getTime() - 86_400_000));

    await setUserTimeZone(db as never, 'user-1', 'America/Chicago');
    // Nothing remembers which instants the old row's seconds started at.
    expect(await days()).toEqual([
      { day: utcDay(at), categoryId: null, seconds: 600 },
      { day: dayBefore(recent), categoryId: null, seconds: 300 },
    ]);
  });

  it('changes nothing when the zone is set to what it already is', async () => {
    await setZone('user-1', 'America/Chicago');
    await db.insert(activities).values([activity('a1', '2026-08-11T02:00:00Z', 600)]);
    await rollupActivities(db as never);

    // Were this re-bucketed from the stored zone as if it were new, the row
    // would be wrong; the same zone must be a no-op.
    const me = await setUserTimeZone(db as never, 'user-1', 'America/Chicago');
    expect(me).toEqual({
      id: 'user-1',
      timeZone: 'America/Chicago',
      effectiveTimeZone: 'America/Chicago',
    });
    expect(await days()).toEqual([{ day: '2026-08-10', categoryId: null, seconds: 600 }]);
  });

  it('follows the server zone for a user without one', async () => {
    await db.execute(sql`set time zone 'Asia/Tokyo'`);
    try {
      const result = await run('{ me { timeZone effectiveTimeZone } }');
      expect((result.data as any).me).toEqual({ timeZone: null, effectiveTimeZone: 'Asia/Tokyo' });
    } finally {
      await db.execute(sql`set time zone 'UTC'`);
    }
  });
});
