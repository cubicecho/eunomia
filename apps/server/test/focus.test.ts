import { asc, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  ACCRUE_CAP_SECONDS,
  CLOSE_AFTER_SECONDS,
  foldPing,
  IDLE_THRESHOLD_SECONDS,
} from '../src/activity/fold.ts';
import { pruneActivities, rollupActivities } from '../src/activity/rollup.ts';
import { activities, devices, focusSegments, user } from '../src/db/schema.ts';
import { createMigratedTestDb } from './helpers/test-db.ts';

const T0 = new Date('2026-08-16T12:00:00.000Z');
const at = (seconds: number) => new Date(T0.getTime() + seconds * 1000);

describe('focus segments', () => {
  let db: Awaited<ReturnType<typeof createMigratedTestDb>>;
  const deviceId = 'device-1';

  beforeEach(async () => {
    db = await createMigratedTestDb();
    await db.insert(user).values({ id: 'user-1', name: 'u', email: 'u@example.com' });
    await db
      .insert(devices)
      .values({ id: deviceId, userId: 'user-1', name: 'laptop', platform: 'linux' });
  });

  const ping = (seconds: number, app: string | null, idleSeconds = 0) =>
    foldPing(db, deviceId, { capturedAt: at(seconds), app, title: null, idleSeconds });

  /** The timeline as [app, start, end] in seconds from T0. */
  const timeline = async () => {
    const rows = await db
      .select({
        app: activities.app,
        startedAt: focusSegments.startedAt,
        endedAt: focusSegments.endedAt,
      })
      .from(focusSegments)
      .innerJoin(activities, eq(activities.id, focusSegments.activityId))
      .orderBy(asc(focusSegments.startedAt));
    const s = (d: Date) => (d.getTime() - T0.getTime()) / 1000;
    return rows.map((row) => [row.app, s(row.startedAt), s(row.endedAt)]);
  };

  /** Seconds per app, once from the segments' spans and once from activeSeconds. */
  const totals = async () => {
    const spans: Record<string, number> = {};
    for (const [app, start, end] of await timeline()) {
      spans[app as string] = (spans[app as string] ?? 0) + (end as number) - (start as number);
    }
    const accrued: Record<string, number> = {};
    for (const row of await db.select().from(activities)) {
      accrued[row.app] = (accrued[row.app] ?? 0) + row.activeSeconds;
    }
    return { spans, accrued };
  };

  it('extends one segment while focus stays put', async () => {
    for (let t = 0; t <= 60; t += 10) await ping(t, 'code');
    expect(await timeline()).toEqual([['code', 0, 60]]);
  });

  it('records switches in order, back and forth, meeting end to start', async () => {
    // Two activity rows, but five segments: the order activities can't hold.
    for (let t = 0; t < 300; t += 10) {
      await ping(t, Math.floor(t / 60) % 2 === 0 ? 'code' : 'firefox');
    }
    expect(await timeline()).toEqual([
      ['code', 0, 50],
      ['firefox', 50, 110],
      ['code', 110, 170],
      ['firefox', 170, 230],
      ['code', 230, 290],
    ]);
    expect(await db.select().from(activities)).toHaveLength(2);
    const { spans, accrued } = await totals();
    expect(spans).toEqual(accrued);
  });

  it('breaks a segment where the fold stops crediting a gap', async () => {
    await ping(0, 'code');
    await ping(10, 'code');
    // Past the accrual cap but short of closing: the activity stays open and
    // is credited only the cap, so the segment restarts that far back.
    await ping(10 + ACCRUE_CAP_SECONDS + 60, 'code');
    await ping(10 + ACCRUE_CAP_SECONDS + 70, 'code');
    expect(await timeline()).toEqual([
      ['code', 0, 10],
      ['code', 70, 110],
    ]);
    const { spans, accrued } = await totals();
    expect(spans).toEqual(accrued);
  });

  it('cuts at the moment input stopped, as the idle walk-back does', async () => {
    for (let t = 0; t <= 200; t += 10) await ping(t, 'code');
    // The idle ramp: still in front, nobody touching anything since 180.
    await ping(210, 'code', 30);
    await ping(220, 'code', 40);
    // Past the threshold: the fold takes 220 back to 180, and so does the segment.
    await ping(180 + IDLE_THRESHOLD_SECONDS, 'code', IDLE_THRESHOLD_SECONDS);
    await ping(400, 'code');
    expect(await timeline()).toEqual([
      ['code', 0, 180],
      ['code', 400 - ACCRUE_CAP_SECONDS, 400],
    ]);
    const { spans, accrued } = await totals();
    expect(spans).toEqual(accrued);
  });

  it('drops a focus that only began after input stopped', async () => {
    for (let t = 0; t <= 200; t += 10) await ping(t, 'code');
    // firefox comes to the front on its own during the idle ramp.
    await ping(210, 'firefox', 30);
    await ping(220, 'firefox', 40);
    await ping(180 + IDLE_THRESHOLD_SECONDS, 'firefox', IDLE_THRESHOLD_SECONDS);
    expect(await timeline()).toEqual([['code', 0, 200]]);
    // Its activity stays, emptied — the segment was all it had.
    const [firefox] = await db.select().from(activities).where(eq(activities.app, 'firefox'));
    expect(firefox?.activeSeconds).toBe(0);
  });

  it('ends a segment at a silence that closes the activity, with a fresh one after', async () => {
    await ping(0, 'code');
    await ping(10, 'code');
    const back = 10 + CLOSE_AFTER_SECONDS + 1;
    await ping(back, 'code');
    await ping(back + 10, 'code');
    expect(await timeline()).toEqual([
      ['code', 0, 10],
      ['code', back, back + 10],
    ]);
    const rows = await db.select().from(activities).orderBy(asc(activities.startedAt));
    const segments = await db.select().from(focusSegments).orderBy(asc(focusSegments.startedAt));
    expect(segments.map((s) => s.activityId)).toEqual(rows.map((r) => r.id));
  });

  it('goes with its activity when retention prunes it', async () => {
    const old = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000);
    await foldPing(db, deviceId, { capturedAt: old, app: 'code', title: null, idleSeconds: 0 });
    await foldPing(db, deviceId, {
      capturedAt: new Date(old.getTime() + 10_000),
      app: 'code',
      title: null,
      idleSeconds: 0,
    });
    await db.update(activities).set({ closedAt: at(0) });
    await rollupActivities(db);
    expect(await db.select().from(focusSegments)).toHaveLength(1);

    expect(await pruneActivities(db, 90)).toBe(1);
    expect(await db.select().from(focusSegments)).toEqual([]);
  });
});
