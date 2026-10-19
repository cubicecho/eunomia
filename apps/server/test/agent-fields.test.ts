import { eq } from 'drizzle-orm';
import { graphql } from 'graphql';
import { beforeEach, describe, expect, it } from 'vitest';
import { ingestPings } from '../src/activity/ingest.ts';
import type { RawPing } from '../src/activity/ping-log.ts';
import { activities, categories, type Device, devices, user } from '../src/db/schema.ts';
import { addDays } from '../src/graphql/agent-fields.ts';
import type { Context } from '../src/graphql/context.ts';
import { createSchema } from '../src/graphql/schema.ts';
import { stubAuthGateway } from './helpers/stub-auth.ts';
import { createMigratedTestDb } from './helpers/test-db.ts';

const T0 = new Date('2026-08-16T12:00:00.000Z');
const at = (seconds: number) => new Date(T0.getTime() + seconds * 1000);
const ping = (seconds: number, app: string, extra: Partial<RawPing> = {}): RawPing => ({
  capturedAt: at(seconds),
  app,
  title: null,
  context: null,
  idleSeconds: 0,
  ...extra,
});

describe('agent-shaped reads', () => {
  let db: Awaited<ReturnType<typeof createMigratedTestDb>>;

  const device = async (): Promise<Device> => {
    const [row] = await db.select().from(devices).where(eq(devices.id, 'device-1'));
    return row!;
  };

  const run = async (source: string, userId: string | null = 'user-1') => {
    const result = await graphql({
      schema: createSchema(db as never, stubAuthGateway()),
      source,
      contextValue: {
        db,
        userId: userId ?? undefined,
        deviceId: undefined,
        keyId: undefined,
        headers: new Headers(),
      } as Context,
    });
    return result;
  };
  const data = async <T>(source: string): Promise<T> => {
    const result = await run(source);
    expect(result.errors).toBeUndefined();
    return result.data as T;
  };

  beforeEach(async () => {
    db = await createMigratedTestDb();
    await db.insert(user).values([
      { id: 'user-1', name: 'u', email: 'u@example.com' },
      { id: 'user-2', name: 'v', email: 'v@example.com' },
    ]);
    await db.insert(devices).values([
      { id: 'device-1', userId: 'user-1', name: 'laptop', platform: 'linux' },
      { id: 'device-2', userId: 'user-2', name: 'theirs', platform: 'linux' },
    ]);
    await db
      .insert(categories)
      .values({ id: 'cat-1', userId: 'user-1', name: 'Work', kind: 'work' });
    // On 2026-08-16: 20s of code in "eunomia" (filed under Work by hand), 20s
    // of firefox on a site, and slack's last 10s.
    await ingestPings(db as never, await device(), [
      ping(0, 'code', { title: 'fold.ts — eunomia', context: 'eunomia' }),
      ping(10, 'code', { title: 'fold.ts — eunomia', context: 'eunomia' }),
      ping(20, 'code', { title: 'fold.ts — eunomia', context: 'eunomia' }),
      ping(30, 'firefox', { title: '100% off_sale', context: 'shop.example' }),
      ping(40, 'firefox', { title: '100% off_sale', context: 'shop.example' }),
      ping(50, 'slack'),
    ]);
    await db
      .update(activities)
      .set({ categoryId: 'cat-1', categorySource: 'manual' })
      .where(eq(activities.app, 'code'));
    // Someone else's time, which none of this may show.
    const [theirs] = await db.select().from(devices).where(eq(devices.id, 'device-2'));
    await ingestPings(db as never, theirs!, [ping(0, 'code'), ping(10, 'code')]);
  });

  it('adds calendar days without a time zone getting involved', () => {
    expect(addDays('2026-08-16', 1)).toBe('2026-08-17');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('daySummary: one day at a glance', async () => {
    const { daySummary } = await data<{
      daySummary: {
        day: string;
        totalSeconds: number;
        uncategorizedSeconds: number;
        categories: { name: string | null; seconds: number }[];
        top: { app: string; context: string | null; seconds: number }[];
        devices: { name: string; seconds: number }[];
      };
    }>(`{ daySummary(day: "2026-08-16", top: 2) {
      day totalSeconds uncategorizedSeconds
      categories { name seconds } top { app context seconds } devices { name seconds }
    } }`);
    expect(daySummary.day).toBe('2026-08-16');
    expect(daySummary.totalSeconds).toBe(50);
    expect(daySummary.uncategorizedSeconds).toBe(30);
    expect(daySummary.categories).toEqual([
      { name: null, seconds: 30 },
      { name: 'Work', seconds: 20 },
    ]);
    // The two biggest of three, slack's 10s cut.
    expect(daySummary.top.map((row) => row.app).sort()).toEqual(['code', 'firefox']);
    expect(daySummary.devices).toEqual([{ name: 'laptop', seconds: 50 }]);
  });

  it('daySummary: today by default, and a bad day refused', async () => {
    const { daySummary } = await data<{ daySummary: { day: string } }>('{ daySummary { day } }');
    expect(daySummary.day).toBe(new Date().toISOString().slice(0, 10));
    const bad = await run('{ daySummary(day: "2026-02-31") { day } }');
    expect(bad.errors?.[0]?.extensions?.code).toBe('BAD_USER_INPUT');
  });

  it('uncategorized: the review queue, largest first', async () => {
    const { uncategorized } = await data<{
      uncategorized: { app: string; context: string | null; seconds: number }[];
    }>('{ uncategorized(from: "2026-08-10", to: "2026-08-17") { app context seconds } }');
    expect(uncategorized).toEqual([
      { app: 'firefox', context: 'shop.example', seconds: 20 },
      { app: 'slack', context: null, seconds: 10 },
    ]);
    const one = await data<{ uncategorized: unknown[] }>(
      '{ uncategorized(from: "2026-08-10", to: "2026-08-17", limit: 1) { app } }',
    );
    expect(one.uncategorized).toHaveLength(1);
  });

  it('searchActivity: app, context or title, the caller’s own, % and _ taken literally', async () => {
    type Found = {
      searchActivity: { app: string; deviceName: string; categoryName: string | null }[];
    };
    const byTitle = await data<Found>(
      '{ searchActivity(query: "FOLD.TS") { app deviceName categoryName } }',
    );
    expect(byTitle.searchActivity).toEqual([
      { app: 'code', deviceName: 'laptop', categoryName: 'Work' },
    ]);

    const literal = await data<Found>('{ searchActivity(query: "100% off_") { app } }');
    expect(literal.searchActivity.map((row) => row.app)).toEqual(['firefox']);
    const wildcard = await data<Found>('{ searchActivity(query: "%") { app } }');
    expect(wildcard.searchActivity.map((row) => row.app)).toEqual(['firefox']);

    const outside = await data<Found>(
      '{ searchActivity(query: "code", from: "2026-08-17") { app } }',
    );
    expect(outside.searchActivity).toEqual([]);
  });

  it('previewCategoryRule: what a rule would match, and what it could move', async () => {
    const { previewCategoryRule } = await data<{
      previewCategoryRule: {
        matchedSeconds: number;
        changeableSeconds: number;
        entries: { app: string; seconds: number; manual: number; categoryName: string | null }[];
      };
    }>(`{ previewCategoryRule(appPattern: "^(code|firefox)$", from: "2026-08-10", to: "2026-08-17") {
      matchedSeconds changeableSeconds entries { app seconds manual categoryName }
    } }`);
    expect(previewCategoryRule.matchedSeconds).toBe(40);
    // code was assigned by hand, so a rule would leave it where it is.
    expect(previewCategoryRule.changeableSeconds).toBe(20);
    expect([...previewCategoryRule.entries].sort((a, b) => a.app.localeCompare(b.app))).toEqual([
      { app: 'code', seconds: 20, manual: 1, categoryName: 'Work' },
      { app: 'firefox', seconds: 20, manual: 0, categoryName: null },
    ]);

    const none = await run('{ previewCategoryRule { matchedSeconds } }');
    expect(none.errors?.[0]?.message).toMatch(/at least one pattern/);
    const invalid = await run('{ previewCategoryRule(appPattern: "(") { matchedSeconds } }');
    expect(invalid.errors?.[0]?.extensions?.code).toBe('BAD_USER_INPUT');
  });

  it('are refused to anonymous callers', async () => {
    for (const source of [
      '{ daySummary { day } }',
      '{ uncategorized { app } }',
      '{ searchActivity(query: "x") { app } }',
      '{ previewCategoryRule(appPattern: "x") { matchedSeconds } }',
    ]) {
      const result = await run(source, null);
      expect(result.errors?.[0]?.extensions?.code).toBe('UNAUTHENTICATED');
    }
  });
});
