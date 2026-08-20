import { asc } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  ACCRUE_CAP_SECONDS,
  CLOSE_AFTER_SECONDS,
  foldPing,
  IDLE_THRESHOLD_SECONDS,
} from '../src/activity/fold.ts';
import { activities, devices, user } from '../src/db/schema.ts';
import { createMigratedTestDb } from './helpers/test-db.ts';

const T0 = new Date('2026-08-16T12:00:00.000Z');
const at = (seconds: number) => new Date(T0.getTime() + seconds * 1000);

describe('foldPing', () => {
  let db: Awaited<ReturnType<typeof createMigratedTestDb>>;
  const deviceId = 'device-1';

  beforeEach(async () => {
    db = await createMigratedTestDb();
    await db.insert(user).values({ id: 'user-1', name: 'u', email: 'u@example.com' });
    await db
      .insert(devices)
      .values({ id: deviceId, userId: 'user-1', name: 'laptop', platform: 'linux' });
  });

  const ping = (
    seconds: number,
    app: string | null,
    title: string | null = null,
    idleSeconds = 0,
  ) => foldPing(db, deviceId, { capturedAt: at(seconds), app, title, idleSeconds });

  const allRows = () => db.select().from(activities).orderBy(asc(activities.startedAt));

  it('accrues continuous focus into one activity', async () => {
    await ping(0, 'code');
    await ping(10, 'code');
    const last = await ping(20, 'code');

    const rows = await allRows();
    expect(rows).toHaveLength(1);
    expect(last?.startedAt).toEqual(at(0));
    expect(last?.lastActiveAt).toEqual(at(20));
    expect(last?.activeSeconds).toBe(20);
    expect(last?.closedAt).toBeNull();
  });

  it('keeps rapid context switching to one row per app, splitting the time', async () => {
    // IDE ↔ browser every 60s for 10 minutes: exactly two rows.
    for (let t = 0; t < 600; t += 10) {
      const app = Math.floor(t / 60) % 2 === 0 ? 'code' : 'firefox';
      await ping(t, app);
    }

    const rows = await allRows();
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.app).sort()).toEqual(['code', 'firefox']);
    expect(rows.every((r) => r.closedAt === null)).toBe(true);
    const total = rows.reduce((sum, r) => sum + r.activeSeconds, 0);
    expect(total).toBe(590); // every 10s gap accrued, split across the two
    const [a, b] = rows;
    expect(Math.abs(a!.activeSeconds - b!.activeSeconds)).toBeLessThanOrEqual(60);
  });

  it('updates the title in place instead of opening a new activity', async () => {
    await ping(0, 'firefox', 'tab one');
    const updated = await ping(10, 'firefox', 'tab two');

    expect(await allRows()).toHaveLength(1);
    expect(updated?.title).toBe('tab two');
  });

  it('splits the same app into one row per context', async () => {
    const withContext = (seconds: number, context: string | null, title = 'tab') =>
      foldPing(db, deviceId, {
        capturedAt: at(seconds),
        app: 'firefox',
        title,
        context,
        idleSeconds: 0,
      });

    // gmail ↔ youtube every 10s: two rows, both open, time split between them.
    for (let t = 0; t <= 60; t += 10) {
      await withContext(t, (t / 10) % 2 === 0 ? 'mail.google.com' : 'youtube.com');
    }

    const rows = await allRows();
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.context).sort()).toEqual(['mail.google.com', 'youtube.com']);
    expect(rows.every((r) => r.app === 'firefox' && r.closedAt === null)).toBe(true);
    expect(rows.reduce((sum, r) => sum + r.activeSeconds, 0)).toBe(60);

    // Returning to a context revives its row; titles churn within it.
    const revived = await withContext(70, 'mail.google.com', 'Inbox (3)');
    expect(await allRows()).toHaveLength(2);
    expect(revived?.context).toBe('mail.google.com');
    expect(revived?.title).toBe('Inbox (3)');
  });

  it('keeps contextless pings separate from context rows of the same app', async () => {
    await ping(0, 'firefox', 'somewhere');
    const withContext = await foldPing(db, deviceId, {
      capturedAt: at(10),
      app: 'firefox',
      title: 'YouTube',
      context: 'youtube.com',
      idleSeconds: 0,
    });

    expect(await allRows()).toHaveLength(2);
    expect(withContext?.context).toBe('youtube.com');
  });

  it('caps accrual across silences', async () => {
    await ping(0, 'code');
    const resumed = await ping(ACCRUE_CAP_SECONDS + 300, 'code');

    // Same open activity (still under the close threshold), but the silence
    // only accrues up to the cap.
    expect(await allRows()).toHaveLength(1);
    expect(resumed?.activeSeconds).toBe(ACCRUE_CAP_SECONDS);
  });

  it('auto-closes an activity unfocused past the close threshold', async () => {
    await ping(0, 'code');
    await ping(10, 'code');
    // Focus lives elsewhere long enough to close 'code'.
    for (let t = 20; t <= 20 + CLOSE_AFTER_SECONDS + 20; t += 10) await ping(t, 'firefox');

    const rows = await allRows();
    const code = rows.find((r) => r.app === 'code');
    expect(code?.closedAt).toEqual(at(10)); // closed at its last focus, not at detection
    const firefox = rows.find((r) => r.app === 'firefox');
    expect(firefox?.closedAt).toBeNull();
  });

  it('starts a fresh row when refocusing a closed activity', async () => {
    await ping(0, 'code');
    for (let t = 10; t <= 10 + CLOSE_AFTER_SECONDS + 20; t += 10) await ping(t, 'firefox');
    await ping(10 + CLOSE_AFTER_SECONDS + 30, 'code');

    const codeRows = (await allRows()).filter((r) => r.app === 'code');
    expect(codeRows).toHaveLength(2);
    expect(codeRows[0]!.closedAt).not.toBeNull();
    expect(codeRows[1]!.closedAt).toBeNull();
  });

  it('accrues nothing while idle and walks back the idle ramp-up', async () => {
    await ping(0, 'code');
    // Input stops right after t=10; idleSeconds ramps up while pings keep
    // reporting 'code' as focused.
    await ping(10, 'code', null, 0);
    for (let t = 20; t < 10 + IDLE_THRESHOLD_SECONDS; t += 10) await ping(t, 'code', null, t - 10);
    const idle = await ping(10 + IDLE_THRESHOLD_SECONDS, 'code', null, IDLE_THRESHOLD_SECONDS);

    expect(idle).toBeNull();
    const rows = await allRows();
    expect(rows).toHaveLength(1);
    // Everything accrued after input stopped is walked back.
    expect(rows[0]!.activeSeconds).toBe(10);
    expect(rows[0]!.lastActiveAt).toEqual(at(10));
  });

  it('resumes accrual after idle without counting the away time', async () => {
    await ping(0, 'code');
    await ping(10, 'code');
    await ping(10 + IDLE_THRESHOLD_SECONDS, 'code', null, IDLE_THRESHOLD_SECONDS);
    const resumed = await ping(20 + IDLE_THRESHOLD_SECONDS, 'code', null, 0);

    expect(resumed).not.toBeNull();
    const rows = await allRows();
    expect(rows).toHaveLength(1);
    // 10s of real focus + the capped post-idle gap; the idle span itself never accrues.
    expect(rows[0]!.activeSeconds).toBeLessThanOrEqual(10 + ACCRUE_CAP_SECONDS);
  });

  it('ignores pings with no detectable app', async () => {
    expect(await ping(0, null)).toBeNull();
    expect(await allRows()).toHaveLength(0);
  });

  it('ignores duplicate and out-of-order pings', async () => {
    await ping(0, 'code');
    const current = await ping(10, 'code');
    const stale = await ping(5, 'code');

    expect(stale?.id).toBe(current?.id);
    const rows = await allRows();
    expect(rows[0]!.activeSeconds).toBe(10);
    expect(rows[0]!.lastActiveAt).toEqual(at(10));
  });

  it('never accrues across devices', async () => {
    await db
      .insert(devices)
      .values({ id: 'device-2', userId: 'user-1', name: 'desktop', platform: 'windows' });
    await ping(0, 'code');
    const other = await foldPing(db, 'device-2', {
      capturedAt: at(10),
      app: 'code',
      title: null,
      idleSeconds: 0,
    });

    // First ping for device-2: no prior ping there, so nothing accrues yet.
    expect(other?.activeSeconds).toBe(0);
    expect(await allRows()).toHaveLength(2);
  });
});
