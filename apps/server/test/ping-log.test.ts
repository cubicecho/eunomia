import { asc, eq } from 'drizzle-orm';
import { graphql } from 'graphql';
import { beforeEach, describe, expect, it } from 'vitest';
import { ingestPings } from '../src/activity/ingest.ts';
import { prunePings, type RawPing } from '../src/activity/ping-log.ts';
import { activities, type Device, devices, pings, user } from '../src/db/schema.ts';
import type { Context } from '../src/graphql/context.ts';
import { createSchema } from '../src/graphql/schema.ts';
import { stubAuthGateway } from './helpers/stub-auth.ts';
import { createMigratedTestDb } from './helpers/test-db.ts';

const T0 = new Date('2026-08-16T12:00:00.000Z');
const at = (seconds: number) => new Date(T0.getTime() + seconds * 1000);
const raw = (seconds: number, app: string | null, extra: Partial<RawPing> = {}): RawPing => ({
  capturedAt: at(seconds),
  app,
  title: null,
  context: null,
  idleSeconds: 0,
  ...extra,
});

describe('raw ping log', () => {
  let db: Awaited<ReturnType<typeof createMigratedTestDb>>;

  const device = async (): Promise<Device> => {
    const [row] = await db.select().from(devices).where(eq(devices.id, 'device-1'));
    return row!;
  };
  const ingest = async (batch: RawPing[]) => ingestPings(db, await device(), batch);
  const logged = () =>
    db
      .select()
      .from(pings)
      .where(eq(pings.deviceId, 'device-1'))
      .orderBy(asc(pings.capturedAt), asc(pings.seq));

  beforeEach(async () => {
    db = await createMigratedTestDb();
    await db.insert(user).values({ id: 'user-1', name: 'u', email: 'u@example.com' });
    await db
      .insert(devices)
      .values({ id: 'device-1', userId: 'user-1', name: 'laptop', platform: 'linux' });
  });

  it('stores every accepted ping as the agent sent it', async () => {
    const schema = createSchema(db as never, stubAuthGateway());
    const result = await graphql({
      schema,
      source: `mutation {
        recordPings(deviceId: "device-1", pings: [
          { capturedAt: "2026-08-16T12:00:00.000Z", app: "code", title: "a.ts", idleSeconds: 0 },
          { capturedAt: "2026-08-16T12:00:10.000Z", app: "firefox", title: "t", context: "example.com", idleSeconds: 3 },
          { capturedAt: "2026-08-16T12:00:20.000Z", idleSeconds: 200 }
        ])
      }`,
      contextValue: {
        db,
        userId: 'user-1',
        deviceId: undefined,
        keyId: undefined,
        headers: new Headers(),
      } as Context,
    });
    expect(result.errors).toBeUndefined();

    expect((await logged()).map(({ seq: _seq, ...ping }) => ping)).toEqual([
      { deviceId: 'device-1', ...raw(0, 'code', { title: 'a.ts' }) },
      {
        deviceId: 'device-1',
        ...raw(10, 'firefox', { title: 't', context: 'example.com', idleSeconds: 3 }),
      },
      { deviceId: 'device-1', ...raw(20, null, { idleSeconds: 200 }) },
    ]);
  });

  it('drops a retried batch instead of logging or folding it twice', async () => {
    const batch = [raw(0, 'code'), raw(10, 'code'), raw(20, 'code')];
    await ingest(batch);
    const retried = await ingest(batch);

    expect(retried).toEqual([null, null, null]);
    expect(await logged()).toHaveLength(3);
    const [row] = await db.select().from(activities);
    expect(row?.activeSeconds).toBe(20);
    expect((await device()).replayFrom).toBeNull();
  });

  it('keeps two different pings captured at the same instant, in arrival order', async () => {
    // The Android agent closes one app and opens the next at one millisecond.
    await ingest([raw(0, 'code'), raw(10, 'code'), raw(10, 'firefox')]);

    // Logged both, even though the fold gives the second nothing to do (a ping
    // no later than the last one never accrues): the log records what
    // arrived, and seq keeps the order replay has to fold them in.
    const log = await logged();
    expect(log.map((ping) => ping.app)).toEqual(['code', 'code', 'firefox']);
    expect(log[2]!.seq).toBeGreaterThan(log[1]!.seq);
  });

  it('logs a ping older than the head without folding it, and schedules a replay', async () => {
    await ingest([raw(100, 'code'), raw(110, 'code')]);
    const touched = await ingest([raw(50, 'firefox'), raw(40, 'firefox'), raw(120, 'code')]);

    expect(touched.map((activity) => activity?.app ?? null)).toEqual([null, null, 'code']);
    expect(await logged()).toHaveLength(5);
    expect((await db.select().from(activities)).map((a) => a.app)).toEqual(['code']);
    expect((await device()).replayFrom).toEqual(at(40));

    // A later, less-old backfill doesn't move it forwards.
    await ingest([raw(60, 'firefox')]);
    expect((await device()).replayFrom).toEqual(at(40));
  });

  it('logs but never folds or replays a ping from before the complete log', async () => {
    await db
      .update(devices)
      .set({ pingLogFrom: at(1000) })
      .where(eq(devices.id, 'device-1'));
    const touched = await ingest([raw(500, 'code')]);

    expect(touched).toEqual([null]);
    expect(await logged()).toHaveLength(1);
    expect(await db.select().from(activities)).toHaveLength(0);
    expect((await device()).replayFrom).toBeNull();
  });

  it('prunes pings past retention and moves the complete-log mark up to the cutoff', async () => {
    const now = Date.now();
    const daysAgo = (days: number) => new Date(now - days * 24 * 60 * 60 * 1000);
    await db.insert(pings).values([
      { deviceId: 'device-1', capturedAt: daysAgo(100), app: 'code', idleSeconds: 0 },
      { deviceId: 'device-1', capturedAt: daysAgo(10), app: 'code', idleSeconds: 0 },
    ]);

    expect(await prunePings(db, 0)).toBe(0);
    expect(await prunePings(db, 90)).toBe(1);

    expect((await logged()).map((ping) => ping.capturedAt)).toEqual([daysAgo(10)]);
    const mark = (await device()).pingLogFrom!.getTime();
    expect(Math.abs(mark - daysAgo(90).getTime())).toBeLessThan(60_000);

    // Nothing to prune leaves the mark where it is.
    expect(await prunePings(db, 90)).toBe(0);
    expect((await device()).pingLogFrom!.getTime()).toBe(mark);
  });
});
