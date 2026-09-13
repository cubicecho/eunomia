import { and, asc, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { CLOSE_AFTER_SECONDS } from '../src/activity/fold.ts';
import { ingestPings } from '../src/activity/ingest.ts';
import type { RawPing } from '../src/activity/ping-log.ts';
import { replayDevice, replayPending } from '../src/activity/replay.ts';
import { moveRolledSeconds, rollupActivities } from '../src/activity/rollup.ts';
import {
  activities,
  categories,
  categoryRules,
  contextRules,
  type Device,
  devices,
  focusSegments,
  mergeRules,
  summaries,
  user,
} from '../src/db/schema.ts';
import { createMigratedTestDb } from './helpers/test-db.ts';

const T0 = new Date('2026-08-16T20:00:00.000Z');

/**
 * A few days of one device's pings, deterministic but irregular: sub-second
 * jitter, app and context switches, a title-extracted context, a merged app,
 * idle ramps past the threshold, pings with no app, same-instant pairs, and
 * silences both under and over the close threshold (so seams).
 */
function history(): RawPing[] {
  let state = 42;
  const random = () => {
    state = (state * 1103515245 + 12345) % 2 ** 31;
    return state / 2 ** 31;
  };
  const apps: [string | null, string | null, string | null][] = [
    ['code', 'eunomia — fold.ts', null],
    ['code', 'other — index.ts', null],
    ['firefox', 'Inbox', 'mail.google.com'],
    ['firefox', 'Video', 'youtube.com'],
    ['chromium', 'Docs', 'docs.example.com'],
    ['slack', 'general', null],
    [null, null, null],
  ];
  const out: RawPing[] = [];
  let t = T0.getTime();
  let current = apps[0]!;
  let idle = 0;
  // By count, not span: the away gaps spread it over a couple of days.
  while (out.length < 2000) {
    const roll = random();
    if (roll < 0.004) {
      t += (CLOSE_AFTER_SECONDS + 60 + random() * 8 * 3600) * 1000; // away
      idle = 0;
    } else if (roll < 0.01) {
      t += (60 + random() * 600) * 1000; // a gap under the close threshold
    } else {
      t += 9000 + Math.floor(random() * 2000) + random(); // ~10s, sub-ms
    }
    if (random() < 0.05) current = apps[Math.floor(random() * apps.length)]!;
    if (random() < 0.01) idle = 1;
    idle = idle > 0 ? idle + 10 : 0;
    if (idle > 400) idle = 0;
    const [app, title, context] = current;
    const capturedAt = new Date(Math.floor(t));
    out.push({ capturedAt, app, title, context, idleSeconds: idle });
    const next = apps[Math.floor(random() * apps.length)]!;
    // A same-instant pair — but never an exact duplicate, which the log drops.
    if (random() < 0.02 && (next !== current || idle > 0)) {
      const [nextApp, nextTitle, nextContext] = next;
      out.push({
        capturedAt,
        app: nextApp,
        title: nextTitle,
        context: nextContext,
        idleSeconds: 0,
      });
    }
  }
  return out;
}

describe('replay', () => {
  let db: Awaited<ReturnType<typeof createMigratedTestDb>>;

  const device = async (id: string): Promise<Device> => {
    const [row] = await db.select().from(devices).where(eq(devices.id, id));
    return row!;
  };

  const ingestAll = async (id: string, list: RawPing[], batch = 50, rollEvery = 40) => {
    for (let i = 0, n = 0; i < list.length; i += batch, n++) {
      await ingestPings(db, await device(id), list.slice(i, i + batch));
      if (n % rollEvery === rollEvery - 1) await rollupActivities(db);
    }
  };

  /** Derived rows without the fields a rebuild is allowed to change. */
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
    // Segments by the activity they cover rather than its id, which a rebuild
    // changes.
    const segments = await db
      .select({
        app: activities.app,
        context: activities.context,
        activityStartedAt: activities.startedAt,
        startedAt: focusSegments.startedAt,
        endedAt: focusSegments.endedAt,
      })
      .from(focusSegments)
      .innerJoin(activities, eq(activities.id, focusSegments.activityId))
      .where(eq(focusSegments.deviceId, id))
      .orderBy(asc(focusSegments.startedAt), asc(focusSegments.endedAt));
    return {
      activities: rows.map(({ id: _id, deviceId: _device, ...row }) => row),
      summaries: sums.map(({ id: _id, deviceId: _device, ...row }) => row),
      segments,
    };
  };

  const expectSameDerived = (
    actual: Awaited<ReturnType<typeof derived>>,
    expected: Awaited<ReturnType<typeof derived>>,
  ) => {
    // Activities exactly — every second and timestamp a live fold wrote.
    expect(actual.activities).toEqual(expected.activities);
    // Focus segments exactly too, in the order they happened.
    expect(actual.segments).toEqual(expected.segments);
    // Summaries to float residue: a rebuild takes a sum back out and adds its
    // parts back in, which isn't bit-exact.
    expect(actual.summaries.map(({ seconds: _s, ...key }) => key)).toEqual(
      expected.summaries.map(({ seconds: _s, ...key }) => key),
    );
    for (const [i, row] of actual.summaries.entries()) {
      expect(row.seconds).toBeCloseTo(expected.summaries[i]!.seconds, 6);
    }
  };

  beforeEach(async () => {
    db = await createMigratedTestDb();
    await db.insert(user).values({ id: 'user-1', name: 'u', email: 'u@example.com' });
    await db.insert(devices).values([
      { id: 'device-1', userId: 'user-1', name: 'laptop', platform: 'linux' },
      { id: 'device-2', userId: 'user-1', name: 'laptop again', platform: 'linux' },
    ]);
    await db.insert(categories).values([
      { id: 'work', userId: 'user-1', name: 'Work' },
      { id: 'fun', userId: 'user-1', name: 'Fun' },
    ]);
    await db.insert(categoryRules).values([
      { id: 'r1', userId: 'user-1', categoryId: 'work', appPattern: '^code$' },
      { id: 'r2', userId: 'user-1', categoryId: 'fun', contextPattern: 'youtube' },
      // Title-sensitive, so categories churn as titles do.
      { id: 'r3', userId: 'user-1', categoryId: 'work', titlePattern: 'Inbox' },
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

  it('rebuilds exactly what live ingestion folded', async () => {
    const pings = history();
    await ingestAll('device-1', pings);
    // Manual assignments: one on an already-rolled row, one on another.
    const [rolled] = await db
      .select()
      .from(activities)
      .where(and(eq(activities.deviceId, 'device-1'), eq(activities.rolledUp, true)))
      .orderBy(asc(activities.startedAt))
      .limit(1);
    expect(rolled).toBeDefined();
    const [open] = await db
      .select()
      .from(activities)
      .where(eq(activities.deviceId, 'device-1'))
      .orderBy(asc(activities.startedAt))
      .limit(1)
      .offset(3);
    await rollupActivities(db);
    for (const row of [rolled!, open!]) {
      // As assignActivity does it: the category, then the rolled seconds.
      const [before] = await db.select().from(activities).where(eq(activities.id, row.id));
      await db
        .update(activities)
        .set({ categoryId: 'fun', categorySource: 'manual' })
        .where(eq(activities.id, row.id));
      await moveRolledSeconds(db, before!, before!.categoryId, 'fun');
    }
    const live = await derived('device-1');
    expect(live.activities.length).toBeGreaterThan(20);
    expect(live.activities.some((a) => a.closedAt === null)).toBe(true);
    expect(new Set(live.summaries.map((s) => s.day)).size).toBeGreaterThan(1);
    // A real timeline: more switches than rows (returns to an open activity),
    // never overlapping.
    expect(live.segments.length).toBeGreaterThan(live.activities.length);
    for (const [i, segment] of live.segments.entries()) {
      expect(segment.endedAt >= segment.startedAt).toBe(true);
      const next = live.segments[i + 1];
      if (next) expect(next.startedAt >= segment.endedAt).toBe(true);
    }

    const result = await replayDevice(db, 'device-1');

    expect(result.from).toEqual(pings[0]!.capturedAt);
    expect(result.pings).toBe(pings.length);
    expect(result.activities).toBe(live.activities.length);
    expectSameDerived(await derived('device-1'), live);
  });

  it('is the same history whether pings arrive in order or late', async () => {
    const pings = history();
    await ingestAll('device-1', pings);
    await rollupActivities(db);

    // device-2 gets the same pings, but its middle third arrives last.
    const third = Math.floor(pings.length / 3);
    await ingestAll('device-2', pings.slice(0, third));
    await ingestAll('device-2', pings.slice(2 * third));
    await ingestAll('device-2', pings.slice(third, 2 * third));
    expect((await device('device-2')).replayFrom).toEqual(pings[third]!.capturedAt);

    expect(await replayPending(db)).toBe(1);
    await rollupActivities(db);

    expect((await device('device-2')).replayFrom).toBeNull();
    expectSameDerived(await derived('device-2'), await derived('device-1'));
    // Nothing pending: a second pass does nothing.
    expect(await replayPending(db)).toBe(0);
  });

  it('rebuilds only from the seam before `from`, leaving earlier history alone', async () => {
    const pings = history();
    await ingestAll('device-1', pings);
    await rollupActivities(db);
    const live = await derived('device-1');

    const target = pings[Math.floor(pings.length / 2)]!.capturedAt;
    const result = await replayDevice(db, 'device-1', { from: target });

    expect(result.from!.getTime()).toBeLessThanOrEqual(target.getTime());
    expect(result.from!.getTime()).toBeGreaterThan(pings[0]!.capturedAt.getTime());
    expect(result.pings).toBeLessThan(pings.length);
    expectSameDerived(await derived('device-1'), live);
  });

  it('keeps summaries from before the log, and never replays into them', async () => {
    const start = new Date('2026-08-16T20:00:00.000Z');
    const s = (seconds: number) => new Date(start.getTime() + seconds * 1000);
    // History from before the log existed: a rolled summary and a closed
    // activity ending right where the log begins.
    await db.insert(summaries).values({
      id: 'old',
      deviceId: 'device-1',
      day: '2026-01-01',
      app: 'code',
      context: null,
      categoryId: 'work',
      seconds: 1234,
    });
    await db.insert(activities).values({
      id: 'pre-log',
      deviceId: 'device-1',
      app: 'code',
      startedAt: s(-600),
      lastActiveAt: s(0),
      activeSeconds: 600,
    });
    await db
      .update(devices)
      .set({ pingLogFrom: s(0) })
      .where(eq(devices.id, 'device-1'));

    const raw = (seconds: number, app: string): RawPing => ({
      capturedAt: s(seconds),
      app,
      title: null,
      context: null,
      idleSeconds: 0,
    });
    // Within the close threshold of the mark: not a seam, since the unlogged
    // history could still have had something open there.
    await ingestPings(db, await device('device-1'), [raw(60, 'code'), raw(70, 'code')]);
    const later = CLOSE_AFTER_SECONDS + 1000;
    await ingestPings(db, await device('device-1'), [
      raw(later, 'slack'),
      raw(later + 10, 'slack'),
    ]);
    await rollupActivities(db);

    const result = await replayDevice(db, 'device-1');

    expect(result.from).toEqual(s(later));
    expect(result.pings).toBe(2);
    const [old] = await db.select().from(summaries).where(eq(summaries.id, 'old'));
    expect(old?.seconds).toBe(1234);
    const rows = await db
      .select()
      .from(activities)
      .where(eq(activities.deviceId, 'device-1'))
      .orderBy(asc(activities.startedAt));
    // The logged code pings folded live into the pre-log activity (600 + 30 +
    // 10). Replaying them from nothing would have opened a second row for time
    // the first already holds.
    expect(rows.map((row) => [row.id, row.app, row.activeSeconds])).toEqual([
      ['pre-log', 'code', 640],
      [expect.any(String), 'slack', 10],
    ]);
  });

  it('applies the current rules to what it rebuilds', async () => {
    const pings = history();
    await ingestAll('device-1', pings);
    await db.delete(categoryRules).where(eq(categoryRules.id, 'r1'));

    await replayDevice(db, 'device-1');

    const code = await db
      .select()
      .from(activities)
      .where(and(eq(activities.deviceId, 'device-1'), eq(activities.app, 'code')));
    expect(code.length).toBeGreaterThan(0);
    expect(code.every((row) => row.categoryId === null)).toBe(true);
  });

  it('does nothing for a device with an empty log', async () => {
    expect(await replayDevice(db, 'device-1')).toEqual({ from: null, pings: 0, activities: 0 });
    expect(await replayDevice(db, 'no-such-device')).toEqual({
      from: null,
      pings: 0,
      activities: 0,
    });
  });
});
