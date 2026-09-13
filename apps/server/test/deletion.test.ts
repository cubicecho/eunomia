import { and, asc, eq, gte, lt } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  deleteAccount,
  deleteRange,
  loadUserRetention,
  purgeApp,
  setUserRetention,
} from '../src/activity/deletion.ts';
import { ingestPings } from '../src/activity/ingest.ts';
import { prunePings, type RawPing } from '../src/activity/ping-log.ts';
import { replayDevice, replayPending } from '../src/activity/replay.ts';
import { pruneActivities, rollupActivities } from '../src/activity/rollup.ts';
import {
  account,
  activities,
  apikey,
  categories,
  categoryRules,
  contextRules,
  type Device,
  devices,
  erasures,
  focusSegments,
  mergeRules,
  pings,
  session,
  summaries,
  user,
  verification,
} from '../src/db/schema.ts';
import { createMigratedTestDb } from './helpers/test-db.ts';

const T0 = new Date('2026-08-16T20:00:00.000Z');
const at = (seconds: number) => new Date(T0.getTime() + seconds * 1000);
const HOUR = 3600;

/**
 * Nine 20-minute sessions of pings every ~10 seconds, eight hours apart — so
 * three days, a seam at the start of each session — switching between apps
 * and contexts, including a merged one, every couple of minutes.
 */
function history(): RawPing[] {
  const apps: [string, string | null, string | null][] = [
    ['code', 'eunomia — fold.ts', null],
    ['firefox', 'Video', 'youtube.com'],
    ['firefox', 'Inbox', 'mail.google.com'],
    // Merged into firefox / docs.example.com.
    ['chromium', 'Docs', 'docs.example.com'],
    ['slack', 'general', null],
  ];
  const out: RawPing[] = [];
  for (let session = 0; session < 9; session++) {
    for (let i = 0; i < 120; i++) {
      const [app, title, context] = apps[(session + Math.floor(i / 12)) % apps.length]!;
      out.push({
        capturedAt: at(session * 8 * HOUR + i * 10 + (i % 3) * 0.25),
        app,
        title,
        context,
        idleSeconds: 0,
      });
    }
  }
  return out;
}

describe('user deletion', () => {
  let db: Awaited<ReturnType<typeof createMigratedTestDb>>;

  const device = async (id: string): Promise<Device> => {
    const [row] = await db.select().from(devices).where(eq(devices.id, id));
    return row!;
  };

  const ingestAll = async (id: string, list: RawPing[]) => {
    for (let i = 0; i < list.length; i += 50) {
      await ingestPings(db, await device(id), list.slice(i, i + 50));
      if (i % 400 === 350) await rollupActivities(db);
    }
  };

  /** A device's derived rows without the fields a rebuild is allowed to change. */
  const derived = async (id: string) => {
    const rows = await db
      .select()
      .from(activities)
      .where(eq(activities.deviceId, id))
      .orderBy(asc(activities.startedAt), asc(activities.app), asc(activities.context));
    const sums = await db
      .select()
      .from(summaries)
      .where(eq(summaries.deviceId, id))
      .orderBy(asc(summaries.day), asc(summaries.app), asc(summaries.context));
    const segments = await db
      .select({ startedAt: focusSegments.startedAt, endedAt: focusSegments.endedAt })
      .from(focusSegments)
      .where(eq(focusSegments.deviceId, id))
      .orderBy(asc(focusSegments.startedAt));
    return {
      activities: rows.map(({ id: _id, deviceId: _d, rolledUp: _r, ...row }) => row),
      summaries: sums.map(({ id: _id, deviceId: _d, ...row }) => row),
      segments,
    };
  };

  /**
   * Two devices' derived rows compared once both are rolled up: the live
   * one rolled on its own schedule, and summaries are compared to float
   * residue since a rebuild subtracts and re-adds.
   */
  const expectSameDerived = async (actualId: string, expectedId: string) => {
    await rollupActivities(db);
    const actual = await derived(actualId);
    const expected = await derived(expectedId);
    expect(actual.activities).toEqual(expected.activities);
    expect(actual.segments).toEqual(expected.segments);
    expect(actual.summaries.map(({ seconds: _s, ...key }) => key)).toEqual(
      expected.summaries.map(({ seconds: _s, ...key }) => key),
    );
    for (const [i, row] of actual.summaries.entries()) {
      expect(row.seconds).toBeCloseTo(expected.summaries[i]!.seconds, 6);
    }
  };

  beforeEach(async () => {
    db = await createMigratedTestDb();
    await db.insert(user).values([
      { id: 'user-1', name: 'u', email: 'u@example.com' },
      { id: 'user-2', name: 'v', email: 'v@example.com' },
    ]);
    await db.insert(devices).values([
      { id: 'device-1', userId: 'user-1', name: 'laptop', platform: 'linux' },
      // The same machine's history as it would have been without the range.
      { id: 'device-2', userId: 'user-1', name: 'reference', platform: 'linux' },
      { id: 'device-3', userId: 'user-2', name: 'theirs', platform: 'linux' },
    ]);
    await db.insert(contextRules).values({
      id: 'c1',
      userId: 'user-1',
      appPattern: '^code$',
      titlePattern: '^(\\w+) —',
    });
    await db.insert(mergeRules).values({
      id: 'm1',
      userId: 'user-1',
      fromApp: 'chromium',
      fromContext: 'docs.example.com',
      toApp: 'firefox',
      toContext: 'docs.example.com',
    });
  });

  describe('deleteRange', () => {
    // Cuts into the middle of the second session and the third, so the fold
    // has to bridge both edges the way it would have live.
    const from = at(8 * HOUR + 10 * 60);
    const to = at(16 * HOUR + 5 * 60);
    const inRange = (ping: RawPing) => ping.capturedAt >= from && ping.capturedAt < to;

    it('leaves exactly the history the range was never recorded in, where the log covers', async () => {
      const all = history();
      await ingestAll('device-1', all);
      await ingestAll(
        'device-2',
        all.filter((ping) => !inRange(ping)),
      );
      await rollupActivities(db);

      const result = await deleteRange(db, 'user-1', { from, to, deviceId: 'device-1' });

      expect(result).toEqual({
        devices: 1,
        pings: all.filter(inRange).length,
        days: 0,
        partialDays: [],
      });
      await expectSameDerived('device-1', 'device-2');

      // An agent's outbox flushing the stretch afterwards changes nothing:
      // the erasure drops it, so there's nothing for a replay to bring back.
      await ingestAll('device-1', all.filter(inRange));
      await replayPending(db);
      await replayDevice(db, 'device-1');
      await expectSameDerived('device-1', 'device-2');
      // And only on that device: the reference is someone else's machine.
      expect(await db.select().from(erasures)).toMatchObject([
        { deviceId: 'device-1', from, to, app: null },
      ]);
    });

    it('comes out the same whichever order it meets a late upload and the replay timer in', async () => {
      const all = history();
      const late = all.filter((ping) => inRange(ping) || ping.capturedAt >= to);
      const early = all.filter((ping) => ping.capturedAt < from);
      await ingestAll(
        'device-2',
        all.filter((ping) => !inRange(ping)),
      );

      // Deletion first, then the outbox, then the timer; and the outbox
      // first with the deletion racing the timer.
      await ingestAll('device-1', early);
      await deleteRange(db, 'user-1', { from, to, deviceId: 'device-1' });
      await ingestAll('device-1', late);
      await replayPending(db);
      await expectSameDerived('device-1', 'device-2');

      await db.delete(devices).where(eq(devices.id, 'device-1'));
      await db
        .insert(devices)
        .values({ id: 'device-1', userId: 'user-1', name: 'laptop', platform: 'linux' });
      await ingestAll('device-1', early);
      await ingestAll('device-1', late.slice().reverse());
      expect((await device('device-1')).replayFrom).not.toBeNull();
      await Promise.all([
        replayPending(db),
        deleteRange(db, 'user-1', { from, to, deviceId: 'device-1' }),
        replayPending(db),
        ingestPings(db, await device('device-1'), all.filter(inRange).slice(0, 20)),
      ]);
      await replayPending(db);
      await expectSameDerived('device-1', 'device-2');
    });

    it('deletes every device of the user, and no one else', async () => {
      const all = history();
      await ingestAll('device-1', all);
      await ingestAll('device-2', all);
      await ingestAll('device-3', all);

      const result = await deleteRange(db, 'user-1', { from, to });

      expect(result?.devices).toBe(2);
      for (const id of ['device-1', 'device-2']) {
        const left = await db
          .select()
          .from(pings)
          .where(
            and(eq(pings.deviceId, id), gte(pings.capturedAt, from), lt(pings.capturedAt, to)),
          );
        expect(left).toEqual([]);
      }
      const theirs = await db.select().from(pings).where(eq(pings.deviceId, 'device-3'));
      expect(theirs).toHaveLength(all.length);
    });

    it("deletes whole days where there's no log, and says which days it couldn't split", async () => {
      // Imported daily totals for two days, and a pruned stretch of raw
      // activity on the second: the log only starts in August.
      await db
        .update(devices)
        .set({ pingLogFrom: new Date('2026-08-01T00:00:00Z') })
        .where(eq(devices.id, 'device-1'));
      const summary = (day: string, app: string, seconds: number) => ({
        id: `${day}-${app}`,
        deviceId: 'device-1',
        day,
        app,
        context: null,
        categoryId: null,
        seconds,
      });
      await db
        .insert(summaries)
        .values([
          summary('2026-07-01', 'steam', 5000),
          summary('2026-07-02', 'steam', 1000),
          summary('2026-07-02', 'code', 600),
          summary('2026-07-03', 'steam', 700),
        ]);
      await db.insert(activities).values({
        id: 'rolled',
        deviceId: 'device-1',
        app: 'code',
        startedAt: new Date('2026-07-02T10:00:00Z'),
        lastActiveAt: new Date('2026-07-02T10:10:00Z'),
        closedAt: new Date('2026-07-02T10:10:00Z'),
        activeSeconds: 600,
        rolledUp: true,
      });

      const result = await deleteRange(db, 'user-1', {
        from: new Date('2026-06-30T12:00:00Z'),
        to: new Date('2026-07-02T12:00:00Z'),
      });

      // July 1 is inside whole. July 2's steam total may or may not include
      // the morning; its code activity started inside, so it's gone.
      expect(result).toEqual({ devices: 2, pings: 0, days: 1, partialDays: ['2026-07-02'] });
      const left = await db
        .select({ day: summaries.day, app: summaries.app, seconds: summaries.seconds })
        .from(summaries)
        .orderBy(asc(summaries.day));
      expect(left).toEqual([
        { day: '2026-07-02', app: 'steam', seconds: 1000 },
        { day: '2026-07-03', app: 'steam', seconds: 700 },
      ]);
      expect(await db.select().from(activities)).toEqual([]);

      // Reported for as long as it holds time nothing can trace, and not once
      // it holds none.
      const again = await deleteRange(db, 'user-1', {
        from: new Date('2026-07-03T12:00:00Z'),
        to: new Date('2026-07-03T13:00:00Z'),
      });
      expect(again?.partialDays).toEqual(['2026-07-03']);
      await db.delete(summaries);
      const clean = await deleteRange(db, 'user-1', {
        from: new Date('2026-07-03T12:00:00Z'),
        to: new Date('2026-07-03T13:00:00Z'),
      });
      expect(clean?.partialDays).toEqual([]);
    });

    it("splits days in the user's own zone", async () => {
      await db.update(user).set({ timeZone: 'Asia/Tokyo' }).where(eq(user.id, 'user-1'));
      await db.insert(summaries).values({
        id: 's',
        deviceId: 'device-1',
        day: '2026-07-02',
        app: 'steam',
        context: null,
        categoryId: null,
        seconds: 100,
      });
      // Midnight to midnight in Tokyo is 15:00 to 15:00 UTC.
      const result = await deleteRange(db, 'user-1', {
        from: new Date('2026-07-01T15:00:00Z'),
        to: new Date('2026-07-02T15:00:00Z'),
      });
      expect(result).toMatchObject({ days: 1, partialDays: [] });
      expect(await db.select().from(summaries)).toEqual([]);
    });

    it('refuses an empty or backwards range', async () => {
      await expect(deleteRange(db, 'user-1', { from: to, to: from })).rejects.toThrow(
        'The range must end after it starts',
      );
    });
  });

  describe('purgeApp', () => {
    const resolvedRows = async (table: typeof activities | typeof summaries) =>
      db
        .selectDistinct({ app: table.app, context: table.context })
        .from(table)
        .where(eq(table.deviceId, 'device-1'))
        .orderBy(asc(table.app), asc(table.context));

    it('deletes one context of an app everywhere, and keeps it deleted', async () => {
      const all = history();
      await ingestAll('device-1', all);
      await ingestAll('device-3', all);
      await rollupActivities(db);

      const result = await purgeApp(db, 'user-1', { app: 'firefox', context: 'youtube.com' });

      const youtube = all.filter((ping) => ping.context === 'youtube.com');
      expect(result.pings).toBe(youtube.length);
      expect(result.activities).toBeGreaterThan(0);
      expect(result.summaries).toBeGreaterThan(0);
      for (const table of [activities, summaries]) {
        expect(await resolvedRows(table)).toEqual([
          { app: 'code', context: 'eunomia' },
          { app: 'firefox', context: 'docs.example.com' },
          { app: 'firefox', context: 'mail.google.com' },
          { app: 'slack', context: null },
        ]);
      }
      // A replay rebuilds without it, and a late flush doesn't restore it.
      await ingestAll('device-1', youtube);
      await replayDevice(db, 'device-1');
      await rollupActivities(db);
      expect(await resolvedRows(summaries)).not.toContainEqual({
        app: 'firefox',
        context: 'youtube.com',
      });
      // Someone else's youtube is theirs.
      const theirs = await db
        .select()
        .from(pings)
        .where(and(eq(pings.deviceId, 'device-3'), eq(pings.context, 'youtube.com')));
      expect(theirs).toHaveLength(youtube.length);
    });

    it('takes the names merged into an app with it, and records it again from now on', async () => {
      const all = history();
      await ingestAll('device-1', all);
      await rollupActivities(db);

      const result = await purgeApp(db, 'user-1', { app: 'firefox', context: null });

      expect(result.pings).toBe(
        all.filter((ping) => ping.app === 'firefox' || ping.app === 'chromium').length,
      );
      expect(await resolvedRows(activities)).toEqual([
        { app: 'code', context: 'eunomia' },
        { app: 'slack', context: null },
      ]);
      const left = await db.select({ app: pings.app }).from(pings);
      expect(new Set(left.map((ping) => ping.app))).toEqual(new Set(['code', 'slack']));

      const now = Date.now();
      await ingestPings(db, await device('device-1'), [
        {
          capturedAt: new Date(now - 60_000),
          app: 'firefox',
          title: null,
          context: null,
          idleSeconds: 0,
        },
        {
          capturedAt: new Date(now + 1000),
          app: 'firefox',
          title: null,
          context: null,
          idleSeconds: 0,
        },
      ]);
      const firefox = await db.select().from(pings).where(eq(pings.app, 'firefox'));
      expect(firefox.map((ping) => ping.capturedAt)).toEqual([new Date(now + 1000)]);
    });

    it('refuses a blank app', async () => {
      await expect(purgeApp(db, 'user-1', { app: '  ', context: null })).rejects.toThrow(
        'Name the app to delete',
      );
    });
  });

  describe('retention', () => {
    const daysAgo = (days: number) => new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const seed = async () => {
      for (const deviceId of ['device-1', 'device-3']) {
        await db.insert(pings).values([
          { deviceId, capturedAt: daysAgo(10), app: 'code', idleSeconds: 0 },
          { deviceId, capturedAt: daysAgo(2), app: 'code', idleSeconds: 0 },
        ]);
        await db.insert(activities).values({
          id: `${deviceId}-old`,
          deviceId,
          app: 'code',
          startedAt: daysAgo(10),
          lastActiveAt: daysAgo(10),
          closedAt: daysAgo(10),
          activeSeconds: 10,
          rolledUp: true,
        });
      }
    };

    it("prunes a user's raw history at the shorter of their retention and the server's", async () => {
      await seed();
      await setUserRetention(db, 'user-1', 5, 90);

      expect(await pruneActivities(db, 90)).toBe(1);
      expect(await prunePings(db, 90)).toBe(1);
      // A server keeping everything still honours the user who asked for less.
      await setUserRetention(db, 'user-1', 1, 0);
      expect(await prunePings(db, 0)).toBe(1);

      const left = await db
        .select({ deviceId: pings.deviceId })
        .from(pings)
        .orderBy(asc(pings.deviceId));
      expect(left.map((row) => row.deviceId)).toEqual(['device-3', 'device-3']);
      expect((await db.select({ id: activities.id }).from(activities)).map((r) => r.id)).toEqual([
        'device-3-old',
      ]);
      const mark = (await device('device-1')).pingLogFrom!.getTime();
      expect(Math.abs(mark - daysAgo(1).getTime())).toBeLessThan(60_000);
      expect((await device('device-3')).pingLogFrom).toBeNull();
    });

    it('can only shorten what the server keeps', async () => {
      await expect(setUserRetention(db, 'user-1', 91, 90)).rejects.toThrow('90 days');
      await expect(setUserRetention(db, 'user-1', 0, 90)).rejects.toThrow('at least one day');
      await expect(setUserRetention(db, 'user-1', 1.5, 90)).rejects.toThrow('at least one day');
      expect(await loadUserRetention(db, 'user-1', 90)).toEqual({
        retentionDays: null,
        effectiveRetentionDays: 90,
      });
      await setUserRetention(db, 'user-1', 30, 90);
      expect(await loadUserRetention(db, 'user-1', 90)).toEqual({
        retentionDays: 30,
        effectiveRetentionDays: 30,
      });
      // Any number is fewer than forever.
      await setUserRetention(db, 'user-1', 4000, 0);
      expect(await loadUserRetention(db, 'user-1', 0)).toEqual({
        retentionDays: 4000,
        effectiveRetentionDays: 4000,
      });
      await setUserRetention(db, 'user-1', null, 0);
      expect(await loadUserRetention(db, 'user-1', 0)).toEqual({
        retentionDays: null,
        effectiveRetentionDays: null,
      });
    });
  });

  describe('deleteAccount', () => {
    it('deletes everything the user had, and nothing of anyone else', async () => {
      const all = history().slice(0, 300);
      await ingestAll('device-1', all);
      await ingestAll('device-3', all);
      await rollupActivities(db);
      await purgeApp(db, 'user-1', { app: 'slack', context: null });
      for (const userId of ['user-1', 'user-2']) {
        await db.insert(categories).values({ id: `${userId}-cat`, userId, name: 'Work' });
        await db
          .insert(categoryRules)
          .values({ id: `${userId}-rule`, userId, categoryId: `${userId}-cat`, appPattern: 'x' });
        await db.insert(session).values({
          id: `${userId}-session`,
          userId,
          token: `${userId}-token`,
          expiresAt: new Date(Date.now() + 60_000),
        });
        await db.insert(account).values({
          id: `${userId}-account`,
          userId,
          issuer: 'local:credential',
          accountId: userId,
          providerId: 'credential',
        });
        await db
          .insert(apikey)
          .values({ id: `${userId}-key`, referenceId: userId, key: `${userId}-hash` });
      }
      await db.insert(verification).values([
        {
          id: 'link-1',
          identifier: 'hash-1',
          value: JSON.stringify({ email: 'U@example.com', attempt: 0 }),
          expiresAt: new Date(Date.now() + 60_000),
        },
        {
          id: 'link-2',
          identifier: 'hash-2',
          value: JSON.stringify({ email: 'v@example.com', attempt: 0 }),
          expiresAt: new Date(Date.now() + 60_000),
        },
      ]);

      await expect(deleteAccount(db, 'user-1', 'someone@example.com')).rejects.toThrow(
        'Type the email address',
      );
      expect(await deleteAccount(db, 'user-1', 'u@example.com')).toBe(true);
      expect(await deleteAccount(db, 'user-1', 'u@example.com')).toBe(false);

      const tables: [PgTable, string][] = [
        [user, 'user-2'],
        [session, 'user-2-session'],
        [account, 'user-2-account'],
        [apikey, 'user-2-key'],
        [verification, 'link-2'],
        [devices, 'device-3'],
        [categories, 'user-2-cat'],
        [categoryRules, 'user-2-rule'],
      ];
      for (const [table, id] of tables) {
        const rows = (await db.select().from(table)) as { id: string }[];
        expect(rows.map((row) => row.id)).toEqual([id]);
      }
      const owners = async (rows: Promise<{ deviceId: string }[]>) => [
        ...new Set((await rows).map((row) => row.deviceId)),
      ];
      const deviceOf = { deviceId: pings.deviceId };
      expect(await owners(db.select(deviceOf).from(pings))).toEqual(['device-3']);
      for (const table of [activities, focusSegments, summaries, erasures]) {
        const rows = db.select({ deviceId: table.deviceId }).from(table);
        expect(await owners(rows)).toEqual(table === erasures ? [] : ['device-3']);
      }
      expect(await db.select().from(contextRules)).toEqual([]);
      expect(await db.select().from(mergeRules)).toEqual([]);
    });
  });
});
