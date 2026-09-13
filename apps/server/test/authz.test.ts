import { eq } from 'drizzle-orm';
import { graphql } from 'graphql';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  activities,
  categories,
  categoryRules,
  devices,
  focusSegments,
  user,
} from '../src/db/schema.ts';
import type { Context } from '../src/graphql/context.ts';
import { createSchema } from '../src/graphql/schema.ts';
import { stubAuthGateway } from './helpers/stub-auth.ts';
import { createMigratedTestDb } from './helpers/test-db.ts';

describe('authorization scoping', () => {
  let db: Awaited<ReturnType<typeof createMigratedTestDb>>;
  let schema: ReturnType<typeof createSchema>;

  // null = anonymous caller (an explicit undefined would trigger the 'user-1'
  // default parameter and silently run the query authenticated).
  const asUser = (userId: string | null): Context =>
    ({
      db,
      userId: userId ?? undefined,
      deviceId: undefined,
      keyId: undefined,
      headers: new Headers(),
    }) as Context;

  const run = (source: string, userId: string | null = 'user-1') =>
    graphql({ schema, source, contextValue: asUser(userId) });

  const data = async (source: string, userId: string | null = 'user-1') => {
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
      { id: 'device-1', userId: 'user-1', name: 'laptop', platform: 'linux' },
      { id: 'device-2', userId: 'user-2', name: 'desktop', platform: 'windows' },
    ]);
    await db.insert(categories).values([
      { id: 'cat-1', userId: 'user-1', name: 'Work' },
      { id: 'cat-2', userId: 'user-2', name: 'Games' },
    ]);
    await db.insert(categoryRules).values([
      { id: 'rule-1', userId: 'user-1', categoryId: 'cat-1', appPattern: 'code' },
      { id: 'rule-2', userId: 'user-2', categoryId: 'cat-2', appPattern: 'steam' },
    ]);
    await db.insert(activities).values([
      {
        id: 'act-1',
        deviceId: 'device-1',
        app: 'code',
        startedAt: new Date('2026-08-17T12:00:00Z'),
        lastActiveAt: new Date('2026-08-17T12:10:00Z'),
        activeSeconds: 600,
        categoryId: 'cat-1',
        categorySource: 'manual' as const,
      },
      {
        id: 'act-2',
        deviceId: 'device-1',
        app: 'firefox',
        startedAt: new Date('2026-08-17T13:00:00Z'),
        lastActiveAt: new Date('2026-08-17T13:05:00Z'),
        activeSeconds: 300,
      },
      {
        id: 'act-theirs',
        deviceId: 'device-2',
        app: 'steam',
        startedAt: new Date('2026-08-17T12:00:00Z'),
        lastActiveAt: new Date('2026-08-17T12:30:00Z'),
        activeSeconds: 1800,
      },
    ]);
  });

  it('scopes every list query to the caller', async () => {
    const mine = await data(
      '{ devices { id } activities { id } categories { id } categoryRules { id } }',
    );
    expect(mine.devices.map((d: any) => d.id)).toEqual(['device-1']);
    expect(mine.activities.map((a: any) => a.id).sort()).toEqual(['act-1', 'act-2']);
    expect(mine.categories.map((c: any) => c.id)).toEqual(['cat-1']);
    expect(mine.categoryRules.map((r: any) => r.id)).toEqual(['rule-1']);

    const theirs = await data(
      '{ devices { id } activities { id } categories { id } categoryRules { id } }',
      'user-2',
    );
    expect(theirs.devices.map((d: any) => d.id)).toEqual(['device-2']);
    expect(theirs.activities.map((a: any) => a.id)).toEqual(['act-theirs']);
    expect(theirs.categories.map((c: any) => c.id)).toEqual(['cat-2']);
    expect(theirs.categoryRules.map((r: any) => r.id)).toEqual(['rule-2']);
  });

  it('where filters cannot widen the fence', async () => {
    const direct = await data('{ devices(where: { userId: { eq: "user-1" } }) { id } }', 'user-2');
    expect(direct.devices).toEqual([]);

    const viaOr = await data(
      '{ categories(where: { OR: [{ userId: { eq: "user-1" } }, { userId: { eq: "user-2" } }] }) { id } }',
      'user-2',
    );
    expect(viaOr.categories.map((c: any) => c.id)).toEqual(['cat-2']);

    const byDevice = await data(
      '{ activities(where: { deviceId: { eq: "device-1" } }) { id } }',
      'user-2',
    );
    expect(byDevice.activities).toEqual([]);
  });

  it('relation filters cannot widen the fence either', async () => {
    // A filter that reaches through a relation is a second way to name rows,
    // and the scope is ANDed on after it — so naming someone else's device
    // through activities.device narrows to nothing rather than reaching it.
    const throughDevice = await data(
      '{ activities(where: { device: { userId: { eq: "user-1" } } }) { id } }',
      'user-2',
    );
    expect(throughDevice.activities).toEqual([]);
  });

  it('refuses a page larger than the maximum', async () => {
    // Rejected, not truncated: a short page tells a paginating client it has
    // reached the end when it has not.
    const result = await run('{ activities(limit: 5000) { id } }');
    expect(result.errors?.[0]?.message).toMatch(/exceeds the maximum/);
  });

  it('filters, ordering, and pagination still work inside the fence', async () => {
    const filtered = await data('{ activities(where: { app: { eq: "code" } }) { id app } }');
    expect(filtered.activities).toEqual([{ id: 'act-1', app: 'code' }]);

    const paged = await data(
      '{ activities(orderBy: { startedAt: { direction: desc, priority: 1 } }, limit: 1) { id startedAt } }',
    );
    // graphql-scalars' DateTime hands back Date objects for in-process calls.
    expect(paged.activities).toEqual([
      { id: 'act-2', startedAt: new Date('2026-08-17T13:00:00.000Z') },
    ]);
  });

  it('nested relations only traverse the caller-owned graph', async () => {
    const result = await data(
      '{ categories { id activities { id } } devices { id activities { id } } }',
    );
    expect(result.categories).toEqual([{ id: 'cat-1', activities: [{ id: 'act-1' }] }]);
    // Newest first, relation reads included: activities carry a default
    // orderBy (entities.ts) for requests that name none.
    expect(result.devices).toEqual([
      { id: 'device-1', activities: [{ id: 'act-2' }, { id: 'act-1' }] },
    ]);
  });

  it('scopes focus segments to the caller, through filters and relations alike', async () => {
    const segment = (id: string, deviceId: string, activityId: string, minute: number) => ({
      id,
      deviceId,
      activityId,
      startedAt: new Date(Date.UTC(2026, 7, 17, 12, minute)),
      endedAt: new Date(Date.UTC(2026, 7, 17, 12, minute + 1)),
    });
    await db
      .insert(focusSegments)
      .values([
        segment('seg-2', 'device-1', 'act-2', 5),
        segment('seg-1', 'device-1', 'act-1', 0),
        segment('seg-theirs', 'device-2', 'act-theirs', 0),
      ]);

    // Oldest first by default: segments are read as a timeline.
    const mine = await data('{ focusSegments { id activity { app } } }');
    expect(mine.focusSegments).toEqual([
      { id: 'seg-1', activity: { app: 'code' } },
      { id: 'seg-2', activity: { app: 'firefox' } },
    ]);
    const theirs = await data('{ focusSegments { id } }', 'user-2');
    expect(theirs.focusSegments).toEqual([{ id: 'seg-theirs' }]);

    // The read a timeline makes: one device, one time range.
    const ranged = await data(
      '{ focusSegments(where: { deviceId: { eq: "device-1" }, startedAt: { gte: "2026-08-17T12:03:00Z" } }) { id } }',
    );
    expect(ranged.focusSegments).toEqual([{ id: 'seg-2' }]);

    for (const where of [
      '{ deviceId: { eq: "device-1" } }',
      '{ device: { userId: { eq: "user-1" } } }',
      '{ activity: { app: { eq: "code" } } }',
    ]) {
      const widened = await data(`{ focusSegments(where: ${where}) { id } }`, 'user-2');
      expect(widened.focusSegments).toEqual([]);
    }

    expect((await run('{ focusSegments { id } }', null)).errors?.[0]?.message).toBe(
      'Not authenticated',
    );
  });

  it('rejects anonymous access to protected fields but not public ones', async () => {
    for (const source of [
      '{ devices { id } }',
      '{ activities { id } }',
      '{ categories { id } }',
      '{ categoryRules { id } }',
      'mutation { applyCategoryRules }',
      'mutation { updateCategory(id: "cat-1", name: "Mine now") { id } }',
      'mutation { assignEntry(app: "firefox", categoryId: "cat-1", from: "2026-08-17", to: "2026-08-18") }',
      'mutation { registerDevice(name: "x", platform: "linux") { apiKey } }',
    ]) {
      const result = await run(source, null);
      expect(result.errors?.[0]?.message).toBe('Not authenticated');
    }

    const me = await data('{ me { id } }', null);
    expect(me.me).toBeNull();
  });

  it('answers me with the caller alone, key or session', async () => {
    await db.update(user).set({ timeZone: 'Asia/Tokyo' }).where(eq(user.id, 'user-2'));
    const source = '{ me { id timeZone effectiveTimeZone } }';
    expect((await data(source)).me).toEqual({
      id: 'user-1',
      timeZone: null,
      // The test database's session zone — what the server's TZ is in prod.
      effectiveTimeZone: 'UTC',
    });
    expect((await data(source, 'user-2')).me).toEqual({
      id: 'user-2',
      timeZone: 'Asia/Tokyo',
      effectiveTimeZone: 'Asia/Tokyo',
    });
    const viaKey = { ...asUser('user-1'), keyId: 'key-1' } as Context;
    const keyed = await graphql({ schema, source, contextValue: viaKey });
    expect((keyed.data as any).me.id).toBe('user-1');
  });

  it('keeps the getting-started checklist per user, set only from a session', async () => {
    const set = (variables: Record<string, boolean | null>, contextValue: Context) =>
      graphql({
        schema,
        source: `mutation ($dismissed: Boolean, $privacyReviewed: Boolean) {
          setOnboarding(dismissed: $dismissed, privacyReviewed: $privacyReviewed) {
            id onboardingDismissed privacyReviewed
          }
        }`,
        variableValues: variables,
        contextValue,
      });
    const flags = async (userId: string) =>
      (await data('{ me { onboardingDismissed privacyReviewed } }', userId)).me;
    const stamps = async () =>
      (
        await db
          .select({ dismissed: user.onboardingDismissedAt, reviewed: user.privacyReviewedAt })
          .from(user)
          .where(eq(user.id, 'user-1'))
      )[0];

    expect(await flags('user-1')).toEqual({ onboardingDismissed: false, privacyReviewed: false });
    expect((await set({ dismissed: true }, asUser(null))).errors?.[0]?.message).toBe(
      'Not authenticated',
    );
    const viaKey = { ...asUser('user-1'), keyId: 'key-1' } as Context;
    expect((await set({ dismissed: true }, viaKey)).errors?.[0]?.message).toBe('Not authenticated');

    // One flag at a time: the omitted one stays as it was.
    const ticked = await set({ privacyReviewed: true }, asUser('user-1'));
    expect((ticked.data as any).setOnboarding).toEqual({
      id: 'user-1',
      onboardingDismissed: false,
      privacyReviewed: true,
    });
    const firstTick = (await stamps())?.reviewed;
    expect(firstTick).toBeInstanceOf(Date);

    await set({ dismissed: true }, asUser('user-1'));
    expect(await flags('user-1')).toEqual({ onboardingDismissed: true, privacyReviewed: true });
    // Ticking again keeps the first time; the other user is untouched.
    await set({ privacyReviewed: true }, asUser('user-1'));
    expect((await stamps())?.reviewed).toEqual(firstTick);
    expect(await flags('user-2')).toEqual({ onboardingDismissed: false, privacyReviewed: false });

    // And both can be undone.
    await set({ dismissed: false, privacyReviewed: false }, asUser('user-1'));
    expect(await flags('user-1')).toEqual({ onboardingDismissed: false, privacyReviewed: false });
  });

  it('lets only a signed-in user set their own time zone', async () => {
    const set = (timeZone: string | null, contextValue: Context) =>
      graphql({
        schema,
        source: `mutation ($tz: String) { setTimeZone(timeZone: $tz) { id timeZone effectiveTimeZone } }`,
        variableValues: { tz: timeZone },
        contextValue,
      });

    expect((await set('Asia/Tokyo', asUser(null))).errors?.[0]?.message).toBe('Not authenticated');
    // A key acts as its owner everywhere else, but not here.
    const viaKey = { ...asUser('user-1'), keyId: 'key-1' } as Context;
    expect((await set('Asia/Tokyo', viaKey)).errors?.[0]?.message).toBe('Not authenticated');
    const zones = async () =>
      (await db.select({ id: user.id, timeZone: user.timeZone }).from(user)).sort((a, b) =>
        a.id.localeCompare(b.id),
      );
    expect(await zones()).toEqual([
      { id: 'user-1', timeZone: null },
      { id: 'user-2', timeZone: null },
    ]);

    // Stored as Intl spells it, however it was typed.
    const mine = await set(' america/chicago ', asUser('user-1'));
    expect(mine.errors).toBeUndefined();
    expect((mine.data as any).setTimeZone).toEqual({
      id: 'user-1',
      timeZone: 'America/Chicago',
      effectiveTimeZone: 'America/Chicago',
    });
    // There is no argument naming whose zone: it is always the caller's.
    expect(await zones()).toEqual([
      { id: 'user-1', timeZone: 'America/Chicago' },
      { id: 'user-2', timeZone: null },
    ]);

    // Not zones: nonsense, a POSIX string Postgres would read backwards, and
    // a bare offset Intl takes but pg_timezone_names doesn't list.
    for (const bad of ['Mars/Olympus', 'UTC+5', '+05:00', '']) {
      const result = await set(bad, asUser('user-1'));
      expect(result.errors?.[0]?.extensions?.code).toBe('BAD_USER_INPUT');
    }

    const cleared = await set(null, asUser('user-1'));
    expect((cleared.data as any).setTimeZone).toEqual({
      id: 'user-1',
      timeZone: null,
      effectiveTimeZone: 'UTC',
    });
  });

  it('lets only a signed-in owner replay a device', async () => {
    const replay = (id: string, contextValue: Context) =>
      graphql({
        schema,
        source: `mutation ($id: String!) { replayDevice(id: $id) { from pings activities } }`,
        variableValues: { id },
        contextValue,
      });

    expect((await replay('device-1', asUser(null))).errors?.[0]?.message).toBe('Not authenticated');
    // An API key — even the device's own — can't rewrite its history.
    const viaKey = { ...asUser('user-1'), keyId: 'key-1', deviceId: 'device-1' } as Context;
    expect((await replay('device-1', viaKey)).errors?.[0]?.message).toBe('Not authenticated');
    // Someone else's device is as unknown as a device that doesn't exist.
    const theirs = await replay('device-2', asUser('user-1'));
    expect(theirs.errors?.[0]?.message).toBe('Unknown device');
    const [untouched] = await db.select().from(activities).where(eq(activities.id, 'act-theirs'));
    expect(untouched).toBeDefined();

    const mine = await replay('device-1', asUser('user-1'));
    expect(mine.errors).toBeUndefined();
    // No pings logged for it, so nothing to rebuild — and nothing lost.
    expect((mine.data as any).replayDevice).toEqual({ from: null, pings: 0, activities: 0 });
    expect(
      await db.select().from(activities).where(eq(activities.deviceId, 'device-1')),
    ).toHaveLength(2);

    const badFrom = await graphql({
      schema,
      source: 'mutation { replayDevice(id: "device-1", from: "yesterday") { pings } }',
      contextValue: asUser('user-1'),
    });
    expect(badFrom.errors?.[0]?.message).toBe('Invalid from');
  });

  it('lets only a signed-in user export, and only their own account', async () => {
    const exportAs = (contextValue: Context, variables: Record<string, unknown>) =>
      graphql({
        schema,
        source: `query ($format: ExportFormat!, $from: String, $to: String, $cursor: String) {
          accountExport(format: $format, from: $from, to: $to, cursor: $cursor) { data rows next }
        }`,
        variableValues: variables,
        contextValue,
      });

    const anonymous = await exportAs(asUser(null), { format: 'BUNDLE' });
    expect(anonymous.errors?.[0]?.message).toBe('Not authenticated');
    // A key authenticates as its owner, but can't walk out with the history —
    // neither an integration key nor a device's own.
    for (const viaKey of [
      { ...asUser('user-1'), keyId: 'key-1' },
      { ...asUser('user-1'), keyId: 'key-1', deviceId: 'device-1' },
    ] as Context[]) {
      for (const format of ['BUNDLE', 'ACTIVITYWATCH', 'SUMMARIES_CSV']) {
        const refused = await exportAs(viaKey, { format });
        expect(refused.errors?.[0]?.message).toBe('Not authenticated');
      }
    }

    const mine = await exportAs(asUser('user-1'), { format: 'BUNDLE' });
    expect(mine.errors).toBeUndefined();
    const chunk = (mine.data as any).accountExport;
    expect(chunk.next).toBeNull();
    expect(chunk.data).toContain('"id":"act-1"');
    expect(chunk.data).not.toContain('act-theirs');
    expect(chunk.data).not.toContain('user-2');
    expect(chunk.data).not.toContain('Games');

    for (const variables of [
      { format: 'BUNDLE', cursor: 'garbage' },
      { format: 'BUNDLE', from: '2026-08-01' },
      { format: 'SUMMARIES_CSV', from: 'yesterday' },
    ]) {
      const result = await exportAs(asUser('user-1'), variables);
      expect(result.errors?.[0]?.extensions?.code).toBe('BAD_USER_INPUT');
    }
  });

  it('lets only a signed-in user import, and only into their own account', async () => {
    const importAs = (contextValue: Context, variables: Record<string, unknown>) =>
      graphql({
        schema,
        source: `mutation ($source: ImportSource!, $records: [String!]!, $cursor: String, $target: ImportTarget, $done: Boolean) {
          importChunk(source: $source, records: $records, cursor: $cursor, target: $target, done: $done) {
            next accepted skipped pings restart deviceIds warnings
          }
        }`,
        variableValues: variables,
        contextValue,
      });
    const csv = ['Date,Time Spent (seconds),Activity', '2026-08-10,600,steam'];
    const rescueTime = (target: Record<string, unknown>) => ({
      source: 'RESCUETIME',
      records: csv,
      target,
      done: true,
    });

    const anonymous = await importAs(asUser(null), rescueTime({ deviceId: 'device-1' }));
    expect(anonymous.errors?.[0]?.message).toBe('Not authenticated');
    // A key can record pings, but not write a history in wholesale.
    for (const viaKey of [
      { ...asUser('user-1'), keyId: 'key-1' },
      { ...asUser('user-1'), keyId: 'key-1', deviceId: 'device-1' },
    ] as Context[]) {
      const refused = await importAs(viaKey, rescueTime({ deviceId: 'device-1' }));
      expect(refused.errors?.[0]?.message).toBe('Not authenticated');
    }

    // Someone else's device is as unknown as one that doesn't exist.
    const theirs = await importAs(asUser('user-1'), rescueTime({ deviceId: 'device-2' }));
    expect(theirs.errors?.[0]?.message).toBe('Unknown device');
    // Nor can a cursor carry the import there.
    const forged = Buffer.from(
      JSON.stringify({
        v: 1,
        source: 'RESCUETIME',
        state: { deviceId: 'device-2', columns: null },
      }),
    ).toString('base64url');
    const viaCursor = await importAs(asUser('user-1'), {
      source: 'RESCUETIME',
      records: csv,
      cursor: forged,
      done: true,
    });
    expect(viaCursor.errors?.[0]?.message).toBe('Unknown device');

    const mine = await importAs(asUser('user-1'), rescueTime({ deviceId: 'device-1' }));
    expect(mine.errors).toBeUndefined();
    expect((mine.data as any).importChunk).toMatchObject({
      next: null,
      accepted: 1,
      skipped: 0,
      deviceIds: ['device-1'],
    });
    const summary = await data(
      '{ appSummary(from: "2026-08-10", to: "2026-08-11") { app seconds } }',
    );
    expect(summary.appSummary).toEqual([{ app: 'steam', seconds: 600 }]);
    const untouched = await data(
      '{ appSummary(from: "2026-08-10", to: "2026-08-11") { app seconds } }',
      'user-2',
    );
    expect(untouched.appSummary).toEqual([]);

    for (const variables of [
      { source: 'RESCUETIME', records: csv },
      { source: 'RESCUETIME', records: csv, cursor: 'garbage' },
      { source: 'BUNDLE', records: [], target: { deviceId: 'device-1' } },
      { source: 'ACTIVITYWATCH', records: ['not json'], target: { deviceId: 'device-1' } },
    ]) {
      const result = await importAs(asUser('user-1'), variables);
      expect(result.errors?.[0]?.extensions?.code).toBe('BAD_USER_INPUT');
    }
  });

  describe('deleting data', () => {
    const as = (contextValue: Context, source: string, variableValues?: Record<string, unknown>) =>
      graphql({ schema, source, variableValues, contextValue });
    // A key of each kind — an integration key and a device's own.
    const keys = [
      { ...asUser('user-1'), keyId: 'key-1' },
      { ...asUser('user-1'), keyId: 'key-1', deviceId: 'device-1' },
    ] as Context[];
    const activityIds = async () =>
      (await db.select({ id: activities.id }).from(activities)).map((row) => row.id).sort();
    const range = `mutation ($deviceId: String) {
      deleteRange(from: "2026-08-17T00:00:00Z", to: "2026-08-18T00:00:00Z", deviceId: $deviceId) {
        devices pings days partialDays
      }
    }`;
    const purge = 'mutation { purgeApp(app: "steam") { pings activities summaries } }';
    const retention = 'mutation ($days: Int) { setRetention(days: $days) { id retentionDays } }';
    const account = 'mutation ($email: String!) { deleteAccount(email: $email) }';

    it('refuses anonymous callers and API keys, for every deletion', async () => {
      for (const context of [asUser(null), ...keys]) {
        for (const [source, variables] of [
          [range, {}],
          [purge, {}],
          [retention, { days: 1 }],
          [account, { email: 'u@example.com' }],
        ] as const) {
          const result = await as(context, source, variables);
          expect(result.errors?.[0]?.message).toBe('Not authenticated');
        }
      }
      expect(await activityIds()).toEqual(['act-1', 'act-2', 'act-theirs']);
      const [stillThere] = await db.select().from(user).where(eq(user.id, 'user-1'));
      expect(stillThere?.retentionDays).toBeNull();
    });

    it("deletes a range from the caller's devices only", async () => {
      const theirs = await as(asUser('user-1'), range, { deviceId: 'device-2' });
      expect(theirs.errors?.[0]?.message).toBe('Unknown device');
      expect(await activityIds()).toEqual(['act-1', 'act-2', 'act-theirs']);

      const mine = await as(asUser('user-1'), range);
      expect(mine.errors).toBeUndefined();
      expect((mine.data as any).deleteRange).toEqual({
        devices: 1,
        pings: 0,
        days: 1,
        partialDays: [],
      });
      // user-2 had steam at the same time on the same day.
      expect(await activityIds()).toEqual(['act-theirs']);
    });

    it("purges an app from the caller's devices only", async () => {
      const mine = await as(asUser('user-1'), purge);
      expect((mine.data as any).purgeApp).toEqual({ pings: 0, activities: 0, summaries: 0 });
      expect(await activityIds()).toEqual(['act-1', 'act-2', 'act-theirs']);
      const theirs = await as(asUser('user-2'), purge);
      expect((theirs.data as any).purgeApp).toEqual({ pings: 0, activities: 1, summaries: 0 });
      expect(await activityIds()).toEqual(['act-1', 'act-2']);
    });

    it('sets retention for the caller alone', async () => {
      const mine = await as(asUser('user-1'), retention, { days: 7 });
      expect((mine.data as any).setRetention).toEqual({ id: 'user-1', retentionDays: 7 });
      const rows = await db.select({ id: user.id, days: user.retentionDays }).from(user);
      expect(rows.sort((a, b) => a.id.localeCompare(b.id))).toEqual([
        { id: 'user-1', days: 7 },
        { id: 'user-2', days: null },
      ]);
    });

    it("deletes the caller's own account, and only with its email", async () => {
      // Someone else's address doesn't delete theirs, or the caller's.
      const wrong = await as(asUser('user-1'), account, { email: 'v@example.com' });
      expect(wrong.errors?.[0]?.extensions?.code).toBe('BAD_USER_INPUT');
      expect(await db.select({ id: user.id }).from(user)).toHaveLength(2);

      const mine = await as(asUser('user-1'), account, { email: ' U@Example.com ' });
      expect(mine.errors).toBeUndefined();
      expect((mine.data as any).deleteAccount).toBe(true);
      expect((await db.select({ id: user.id }).from(user)).map((row) => row.id)).toEqual([
        'user-2',
      ]);
      expect(await activityIds()).toEqual(['act-theirs']);
    });
  });
});
