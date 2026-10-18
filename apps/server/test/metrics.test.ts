import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ingestPings } from '../src/activity/ingest.ts';
import type { RawPing } from '../src/activity/ping-log.ts';
import { rollupActivities } from '../src/activity/rollup.ts';
import { activities, categories, type Device, devices, user } from '../src/db/schema.ts';
import {
  createMetricsHandler,
  recordUploadDelay,
  renderMetrics,
  resetMetrics,
} from '../src/metrics.ts';
import { createMigratedTestDb } from './helpers/test-db.ts';

const T0 = new Date('2026-08-16T12:00:00.000Z');
const at = (seconds: number) => new Date(T0.getTime() + seconds * 1000);
const raw = (seconds: number, app: string | null): RawPing => ({
  capturedAt: at(seconds),
  app,
  title: null,
  context: null,
  idleSeconds: 0,
});

/** The value of one sample line, e.g. `eunomia_devices{platform="linux"}`. */
function value(text: string, sample: string): number | undefined {
  const line = text.split('\n').find((l) => l.startsWith(`${sample} `));
  return line === undefined ? undefined : Number(line.slice(sample.length + 1));
}

describe('metrics', () => {
  let db: Awaited<ReturnType<typeof createMigratedTestDb>>;
  const device = async (id = 'device-1'): Promise<Device> => {
    const [row] = await db.select().from(devices).where(eq(devices.id, id));
    return row!;
  };

  beforeEach(async () => {
    resetMetrics();
    db = await createMigratedTestDb();
    await db.insert(user).values({ id: 'user-1', name: 'u', email: 'u@example.com' });
    await db.insert(devices).values([
      { id: 'device-1', userId: 'user-1', name: 'laptop', platform: 'linux', lastSeenAt: T0 },
      { id: 'device-2', userId: 'user-1', name: 'phone', platform: 'android' },
    ]);
  });

  it('counts devices by platform and liveness, without naming any', async () => {
    const text = await renderMetrics(db as never, { now: at(120) });
    expect(value(text, 'eunomia_up')).toBe(1);
    expect(value(text, 'eunomia_users')).toBe(1);
    expect(value(text, 'eunomia_devices{platform="linux"}')).toBe(1);
    expect(value(text, 'eunomia_devices{platform="android"}')).toBe(1);
    expect(value(text, 'eunomia_devices{platform="windows"}')).toBe(0);
    expect(value(text, 'eunomia_devices_seen{within="5m"}')).toBe(1);
    expect(value(text, 'eunomia_devices_never_seen')).toBe(1);
    expect(text).not.toContain('laptop');
    expect(text).not.toContain('u@example.com');
    expect(text).not.toContain('eunomia_category_seconds');
  });

  it('counts what ingestion did with each ping', async () => {
    await ingestPings(db as never, await device(), [raw(0, 'code'), raw(10, 'code')]);
    // A retry of the same batch, and a ping from before the log's head.
    await ingestPings(db as never, await device(), [raw(0, 'code'), raw(10, 'code')]);
    await ingestPings(db as never, await device(), [raw(5, 'firefox')]);

    const text = await renderMetrics(db as never);
    expect(value(text, 'eunomia_pings_ingested_total{outcome="folded"}')).toBe(2);
    expect(value(text, 'eunomia_pings_ingested_total{outcome="duplicate"}')).toBe(2);
    expect(value(text, 'eunomia_pings_ingested_total{outcome="backfill"}')).toBe(1);
    expect(value(text, 'eunomia_ping_batches_total')).toBe(3);
    expect(value(text, 'eunomia_devices_replay_pending')).toBe(1);
    expect(value(text, 'eunomia_activities_open')).toBe(1);
  });

  it('buckets upload delay cumulatively', async () => {
    recordUploadDelay([at(0), at(-45), at(-7200)], at(0));
    const text = await renderMetrics(db as never);
    expect(value(text, 'eunomia_upload_delay_seconds_bucket{le="10"}')).toBe(1);
    expect(value(text, 'eunomia_upload_delay_seconds_bucket{le="60"}')).toBe(2);
    expect(value(text, 'eunomia_upload_delay_seconds_bucket{le="3600"}')).toBe(2);
    expect(value(text, 'eunomia_upload_delay_seconds_bucket{le="21600"}')).toBe(3);
    expect(value(text, 'eunomia_upload_delay_seconds_bucket{le="+Inf"}')).toBe(3);
    expect(value(text, 'eunomia_upload_delay_seconds_count')).toBe(3);
    expect(value(text, 'eunomia_upload_delay_seconds_sum')).toBe(7245);
  });

  it('adds per-user category seconds only when asked, rolled and live together', async () => {
    await db.insert(categories).values({ id: 'cat-1', userId: 'user-1', name: 'Work "deep"' });
    await db.insert(user).values({ id: 'user-2', name: 'v', email: 'v@example.com' });
    // 30s of code, closed once firefox has held focus long enough, then
    // categorized and rolled up; firefox is still live and uncategorized.
    await ingestPings(db as never, await device(), [
      raw(0, 'code'),
      raw(10, 'code'),
      raw(20, 'code'),
      raw(30, 'code'),
    ]);
    await ingestPings(db as never, await device(), [raw(1000, 'firefox'), raw(1010, 'firefox')]);
    await db.update(activities).set({ categoryId: 'cat-1' }).where(eq(activities.app, 'code'));
    expect(await rollupActivities(db as never)).toBe(1);

    const text = await renderMetrics(db as never, { perUser: true });
    expect(
      value(text, 'eunomia_category_seconds{user="u@example.com",category="Work \\"deep\\""}'),
    ).toBe(30);
    expect(value(text, 'eunomia_category_seconds{user="u@example.com",category=""}')).toBe(10);
    // A user with no time has no series.
    expect(text).not.toContain('v@example.com');
    expect(text).toContain('# TYPE eunomia_category_seconds gauge');
  });

  it('reports the database down as eunomia_up 0, not a failed scrape', async () => {
    const broken = {
      select: () => {
        throw new Error('connection refused');
      },
    };
    const text = await renderMetrics(broken as never);
    expect(value(text, 'eunomia_up')).toBe(0);
    expect(text).toContain('eunomia_build_info{version=');
  });

  describe('endpoint', () => {
    let server: Server | null = null;
    afterEach(() => {
      server?.close();
      server = null;
    });

    async function serve(token: string | null): Promise<string> {
      const handler = createMetricsHandler(db as never, token);
      server = createServer((req, res) => void handler(req, res));
      await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
      return `http://127.0.0.1:${(server.address() as AddressInfo).port}/metrics`;
    }

    it('is off without a token', async () => {
      const url = await serve(null);
      expect((await fetch(url)).status).toBe(404);
    });

    it('requires the bearer token', async () => {
      const url = await serve('scrape-secret');
      expect((await fetch(url)).status).toBe(401);
      expect((await fetch(url, { headers: { authorization: 'Bearer nope' } })).status).toBe(401);

      const ok = await fetch(url, { headers: { authorization: 'Bearer scrape-secret' } });
      expect(ok.status).toBe(200);
      expect(ok.headers.get('content-type')).toContain('text/plain; version=0.0.4');
      expect(await ok.text()).toContain('eunomia_up 1');
    });

    it('only answers reads', async () => {
      const url = await serve('scrape-secret');
      const res = await fetch(url, {
        method: 'POST',
        headers: { authorization: 'Bearer scrape-secret' },
      });
      expect(res.status).toBe(405);
    });
  });
});
