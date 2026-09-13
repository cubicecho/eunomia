import { eq, inArray } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { ingestPings } from '../src/activity/ingest.ts';
import type { RawPing } from '../src/activity/ping-log.ts';
import { rollupActivities } from '../src/activity/rollup.ts';
import {
  account,
  activities,
  apikey,
  categories,
  categoryRules,
  contextRules,
  type Device,
  devices,
  mergeRules,
  pings,
  session,
  summaries,
  user,
} from '../src/db/schema.ts';
import {
  finishPings,
  hostnames,
  initialConverter,
  type Pass,
  type PingSample,
  pushPing,
  toEvent,
} from '../src/export/activitywatch.ts';
import { type ExportArgs, exportChunk } from '../src/export/chunk.ts';
import { csvField } from '../src/export/csv.ts';
import { createMigratedTestDb } from './helpers/test-db.ts';

const T0 = new Date('2026-08-16T20:00:00.000Z');
const at = (seconds: number) => new Date(T0.getTime() + seconds * 1000);

describe('activitywatch conversion', () => {
  const run = (pass: Pass, samples: [number, string | null, string | null, number][]) => {
    const state = initialConverter();
    const sample = ([seconds, app, title, idleSeconds]: (typeof samples)[number]): PingSample => ({
      at: seconds * 1000,
      app,
      title,
      idleSeconds,
    });
    const spans = samples.flatMap((s) => pushPing(pass, state, sample(s)));
    return [...spans, ...finishPings(state)].map((span) => ({
      from: span.start / 1000,
      to: span.end / 1000,
      data: span.data,
    }));
  };

  it('turns window samples into intervals, crediting each ping the time before it', () => {
    expect(
      run('window', [
        [0, 'code', 'a', 0],
        [10, 'code', 'a', 0],
        // A change is credited from the previous ping, as the fold credits it.
        [20, 'code', 'b', 0],
        // No app: the interval ends, and nothing covers this ping.
        [30, null, null, 0],
        [40, 'code', 'b', 0],
        // A silence past the accrual cap leaves a hole, and only the cap's
        // worth of lead-in is credited on the far side of it.
        [100, 'code', 'b', 0],
        [110, 'code', null, 0],
        // Past the close threshold the fold credits nothing, so no lead-in.
        [1100, 'code', 'c', 0],
        [1110, 'code', 'c', 0],
      ]),
    ).toEqual([
      { from: 0, to: 10, data: { app: 'code', title: 'a' } },
      { from: 10, to: 20, data: { app: 'code', title: 'b' } },
      { from: 30, to: 40, data: { app: 'code', title: 'b' } },
      { from: 70, to: 100, data: { app: 'code', title: 'b' } },
      { from: 100, to: 110, data: { app: 'code', title: '' } },
      { from: 1100, to: 1110, data: { app: 'code', title: 'c' } },
    ]);
  });

  it('cuts away time back to the last input, and resumes where input did', () => {
    // Input stops at 20 s; the ping at 140 s is the first past the threshold.
    const samples: [number, string | null, string | null, number][] = [];
    for (let t = 0; t <= 150; t += 10) samples.push([t, 'code', 'a', Math.max(0, t - 20)]);
    samples.push([160, 'code', 'a', 3], [170, 'code', 'a', 13]);
    expect(run('afk', samples)).toEqual([
      { from: 0, to: 20, data: { status: 'not-afk' } },
      { from: 20, to: 157, data: { status: 'afk' } },
      { from: 157, to: 170, data: { status: 'not-afk' } },
    ]);
  });

  it('writes events the way aw-server stores them', () => {
    expect(
      toEvent({ start: T0.getTime(), end: T0.getTime() + 1500, data: { status: 'afk' } }),
    ).toEqual({ timestamp: '2026-08-16T20:00:00.000Z', duration: 1.5, data: { status: 'afk' } });
  });

  it('gives every device a distinct, bucket-safe hostname', () => {
    const hosts = hostnames([
      { id: 'a', name: 'My Laptop' },
      { id: 'b', name: 'My Laptop' },
      { id: 'c', name: '  ' },
      { id: 'd', name: 'pixel/8 (work)' },
    ]);
    expect([...hosts.values()]).toEqual(['My-Laptop', 'My-Laptop-2', 'device', 'pixel-8-work']);
  });
});

describe('csv fields', () => {
  it('quotes what needs quoting and defuses formulas', () => {
    expect(csvField(null)).toBe('');
    expect(csvField('code')).toBe('code');
    expect(csvField('a,b')).toBe('"a,b"');
    expect(csvField('say "hi"\n')).toBe('"say ""hi""\n"');
    expect(csvField('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    for (const lead of ['+', '-', '@', '\t']) expect(csvField(`${lead}1`)).toBe(`'${lead}1`);
  });
});

describe('account export', () => {
  let db: Awaited<ReturnType<typeof createMigratedTestDb>>;

  const device = async (id: string): Promise<Device> => {
    const [row] = await db.select().from(devices).where(eq(devices.id, id));
    return row!;
  };

  /** Every chunk of an export, concatenated, and how many calls it took. */
  const drain = async (userId: string, args: Omit<ExportArgs, 'cursor'>, pageSize: number) => {
    let data = '';
    let calls = 0;
    let cursor: string | null = null;
    do {
      const chunk = await exportChunk(db, userId, { ...args, cursor }, pageSize);
      data += chunk.data;
      cursor = chunk.next;
      calls += 1;
      expect(calls).toBeLessThan(10_000);
    } while (cursor);
    return { data, calls };
  };

  /** A work session of pings: the given (app, title) every 10 s, then idle. */
  const sessionPings = (start: number, apps: [string, string][], idleTail = 0): RawPing[] => {
    const out: RawPing[] = apps.map(([app, title], i) => ({
      capturedAt: at(start + i * 10),
      app,
      title,
      context: null,
      idleSeconds: 0,
    }));
    for (let i = 1; i <= idleTail; i++) {
      out.push({
        capturedAt: at(start + (apps.length - 1 + i) * 10),
        app: apps.at(-1)![0],
        title: apps.at(-1)![1],
        context: null,
        idleSeconds: i * 10,
      });
    }
    return out;
  };

  beforeEach(async () => {
    db = await createMigratedTestDb();
    await db.insert(user).values([
      { id: 'user-1', name: 'u', email: 'u@example.com' },
      { id: 'user-2', name: 'v', email: 'theirs@example.com' },
    ]);
    await db.insert(devices).values([
      { id: 'device-1', userId: 'user-1', name: 'laptop', platform: 'linux' },
      { id: 'device-2', userId: 'user-2', name: 'their-desktop', platform: 'windows' },
      // Same name as device-1, and one with nothing recorded at all.
      { id: 'device-3', userId: 'user-1', name: 'laptop', platform: 'macos' },
      { id: 'device-4', userId: 'user-1', name: 'phone', platform: 'android' },
    ]);
    await db.insert(categories).values([
      { id: 'cat-1', userId: 'user-1', name: 'Work' },
      { id: 'cat-2', userId: 'user-2', name: 'THEIRS-category' },
    ]);
    await db.insert(categoryRules).values([
      { id: 'rule-1', userId: 'user-1', categoryId: 'cat-1', appPattern: '^code$' },
      { id: 'rule-2', userId: 'user-2', categoryId: 'cat-2', appPattern: 'THEIRS' },
    ]);
    await db.insert(contextRules).values([
      { id: 'ctx-1', userId: 'user-1', titlePattern: '^(\\w+) —' },
      { id: 'ctx-2', userId: 'user-2', titlePattern: 'THEIRS (\\w+)' },
    ]);
    await db.insert(mergeRules).values([
      { id: 'merge-1', userId: 'user-1', fromApp: 'Code', toApp: 'code' },
      { id: 'merge-2', userId: 'user-2', fromApp: 'THEIRS-a', toApp: 'THEIRS-b' },
    ]);
    // Credentials of every kind, for both users — none may reach an export.
    await db.insert(apikey).values([
      { id: 'key-1', key: 'SECRET-key-hash-1', referenceId: 'user-1', start: 'SECRET-start' },
      { id: 'key-2', key: 'SECRET-key-hash-2', referenceId: 'user-2' },
    ]);
    await db.insert(session).values([
      { id: 'sess-1', token: 'SECRET-session-1', userId: 'user-1', expiresAt: at(86400) },
      { id: 'sess-2', token: 'SECRET-session-2', userId: 'user-2', expiresAt: at(86400) },
    ]);
    await db.insert(account).values({
      id: 'acct-1',
      issuer: 'local:credential',
      accountId: 'user-1',
      providerId: 'credential',
      userId: 'user-1',
      password: 'SECRET-password-hash',
    });

    // Two sessions an hour apart on device-1, so the first closes and rolls up.
    await ingestPings(db, await device('device-1'), [
      ...sessionPings(
        0,
        [
          ['code', 'eunomia — fold.ts'],
          ['code', 'eunomia — fold.ts'],
          ['firefox', 'Inbox'],
          ['firefox', 'Inbox'],
          ['code', 'eunomia — ingest.ts'],
        ],
        14,
      ),
      ...sessionPings(18_000, [
        ['code', 'other — index.ts'],
        ['code', 'other — index.ts'],
        ['slack', 'general'],
      ]),
    ]);
    await rollupActivities(db);
    await ingestPings(db, await device('device-3'), sessionPings(60, [['vim', 'notes']]));
    await ingestPings(
      db,
      await device('device-2'),
      sessionPings(0, [
        ['THEIRS-app', 'THEIRS title'],
        ['THEIRS-app', 'THEIRS title'],
      ]),
    );
    await rollupActivities(db);
  });

  describe('bundle', () => {
    it('is the same file however it is paged, and holds only the caller', async () => {
      const whole = await drain('user-1', { format: 'BUNDLE' }, 100_000);
      const paged = await drain('user-1', { format: 'BUNDLE' }, 3);
      expect(whole.calls).toBe(1);
      expect(paged.calls).toBeGreaterThan(10);
      // The header's exportedAt is the only thing allowed to differ.
      const body = (data: string) => data.split('\n').slice(1).join('\n');
      expect(body(paged.data)).toEqual(body(whole.data));

      for (const secret of ['SECRET', 'THEIRS', 'user-2', 'device-2', 'their-desktop', 'theirs@']) {
        expect(whole.data).not.toContain(secret);
      }
    });

    it('is versioned JSON Lines with every kind of record and a closing count', async () => {
      const { data } = await drain('user-1', { format: 'BUNDLE' }, 5);
      expect(data.endsWith('\n')).toBe(true);
      const records = data
        .trimEnd()
        .split('\n')
        .map((line) => JSON.parse(line));
      expect(records[0]).toMatchObject({ format: 'eunomia-export', version: 1 });
      expect(records[1]).toEqual({
        type: 'profile',
        id: 'user-1',
        name: 'u',
        email: 'u@example.com',
        createdAt: expect.any(String),
        timeZone: null,
        effectiveTimeZone: 'UTC',
      });

      const end = records.at(-1);
      expect(end.type).toBe('end');
      const counted: Record<string, number> = {};
      for (const record of records.slice(1, -1)) {
        counted[record.type] = (counted[record.type] ?? 0) + 1;
      }
      expect(end.counts).toEqual(counted);

      // Dependency order: nothing references a row that comes after it.
      const order = records.slice(1, -1).map((record) => record.type);
      const firstOf = (type: string) => order.indexOf(type);
      expect(firstOf('device')).toBeLessThan(firstOf('summary'));
      expect(firstOf('category')).toBeLessThan(firstOf('categoryRule'));
      expect(firstOf('activity')).toBeLessThan(firstOf('focusSegment'));

      const mine = ['device-1', 'device-3', 'device-4'];
      const [storedPings, storedActivities, storedSummaries] = await Promise.all([
        db.select().from(pings).where(inArray(pings.deviceId, mine)),
        db.select().from(activities).where(inArray(activities.deviceId, mine)),
        db.select().from(summaries).where(inArray(summaries.deviceId, mine)),
      ]);
      expect(counted).toMatchObject({
        profile: 1,
        device: 3,
        category: 1,
        categoryRule: 1,
        contextRule: 1,
        mergeRule: 1,
        ping: storedPings.length,
        activity: storedActivities.length,
        summary: storedSummaries.length,
      });
      expect(counted.summary).toBeGreaterThan(0);
      expect(counted.focusSegment).toBeGreaterThan(0);

      // Devices carry no credential of any kind — only what describes them.
      expect(Object.keys(records.find((record) => record.type === 'device')).sort()).toEqual([
        'createdAt',
        'id',
        'lastSeenAt',
        'name',
        'pingLogFrom',
        'platform',
        'replayFrom',
        'type',
      ]);
      // Pings in fold order per device, as an importer must replay them.
      const logged = records.filter((record) => record.type === 'ping');
      expect(logged[0]).toEqual({
        type: 'ping',
        deviceId: 'device-1',
        capturedAt: T0.toISOString(),
        app: 'code',
        title: 'eunomia — fold.ts',
        context: null,
        idleSeconds: 0,
      });
      const times = logged.map((ping) => `${ping.deviceId} ${ping.capturedAt}`);
      expect(times).toEqual([...times].sort());
    });

    it('takes no date range', async () => {
      await expect(
        exportChunk(db, 'user-1', { format: 'BUNDLE', from: '2026-08-01' }),
      ).rejects.toThrow(/no date range/);
    });
  });

  describe('activitywatch', () => {
    it('writes an aw-server export document, the same however it is paged', async () => {
      const whole = await drain('user-1', { format: 'ACTIVITYWATCH' }, 100_000);
      const paged = await drain('user-1', { format: 'ACTIVITYWATCH' }, 2);
      expect(paged.calls).toBeGreaterThan(10);
      expect(paged.data).toEqual(whole.data);
      for (const secret of ['SECRET', 'THEIRS', 'their-desktop']) {
        expect(whole.data).not.toContain(secret);
      }

      const { buckets } = JSON.parse(whole.data);
      // Two per device with pings; the phone recorded nothing and gets none.
      expect(Object.keys(buckets)).toEqual([
        'aw-watcher-window_laptop',
        'aw-watcher-afk_laptop',
        'aw-watcher-window_laptop-2',
        'aw-watcher-afk_laptop-2',
      ]);
      const window = buckets['aw-watcher-window_laptop'];
      expect(window).toMatchObject({
        id: 'aw-watcher-window_laptop',
        type: 'currentwindow',
        client: 'aw-watcher-window',
        hostname: 'laptop',
        data: {},
      });
      expect(new Date(window.created).getTime()).not.toBeNaN();
      expect(buckets['aw-watcher-afk_laptop']).toMatchObject({
        type: 'afkstatus',
        client: 'aw-watcher-afk',
        hostname: 'laptop',
      });

      expect(window.events.slice(0, 3)).toEqual([
        {
          timestamp: at(0).toISOString(),
          duration: 10,
          data: { app: 'code', title: 'eunomia — fold.ts' },
        },
        { timestamp: at(10).toISOString(), duration: 20, data: { app: 'firefox', title: 'Inbox' } },
        // The idle tail stays on the window: ActivityWatch intersects with afk itself.
        {
          timestamp: at(30).toISOString(),
          duration: 150,
          data: { app: 'code', title: 'eunomia — ingest.ts' },
        },
      ]);
      expect(buckets['aw-watcher-afk_laptop'].events.slice(0, 2)).toEqual([
        { timestamp: at(0).toISOString(), duration: 40, data: { status: 'not-afk' } },
        { timestamp: at(40).toISOString(), duration: 140, data: { status: 'afk' } },
      ]);
    });

    it('limits to whole days in the owner zone', async () => {
      // 20:00 UTC on the 16th; the second session is 01:00 UTC on the 17th.
      const days = async () => {
        const { data } = await drain(
          'user-1',
          { format: 'ACTIVITYWATCH', from: '2026-08-17', to: '2026-08-18' },
          100_000,
        );
        return JSON.parse(data).buckets['aw-watcher-window_laptop'].events.map(
          (event: { data: { app: string } }) => event.data.app,
        );
      };
      expect(await days()).toEqual(['code', 'slack']);
      // In Tokyo both sessions are on the 17th.
      await db.update(user).set({ timeZone: 'Asia/Tokyo' }).where(eq(user.id, 'user-1'));
      expect(await days()).toEqual(['code', 'firefox', 'code', 'code', 'slack']);
    });

    it('is still a valid document when there is nothing to export', async () => {
      const { data } = await drain(
        'user-1',
        { format: 'ACTIVITYWATCH', from: '2020-01-01', to: '2020-01-02' },
        100,
      );
      expect(JSON.parse(data)).toEqual({ buckets: {} });
    });
  });

  describe('summaries csv', () => {
    beforeEach(async () => {
      await db.delete(activities);
      await db.delete(summaries);
      await db.insert(summaries).values([
        {
          id: 's-1',
          deviceId: 'device-1',
          day: '2026-06-01',
          app: 'code',
          categoryId: 'cat-1',
          seconds: 100.25,
        },
        {
          id: 's-2',
          deviceId: 'device-1',
          day: '2026-08-15',
          app: 'code',
          categoryId: 'cat-1',
          seconds: 50,
        },
        { id: 's-3', deviceId: 'device-2', day: '2026-08-15', app: 'THEIRS', seconds: 999 },
      ]);
      await db.insert(activities).values([
        // Not rolled up yet: the live half, which lands on the same day's row
        // as the rolled one.
        {
          id: 'a-1',
          deviceId: 'device-1',
          app: 'code',
          categoryId: 'cat-1',
          startedAt: new Date('2026-08-15T10:00:00Z'),
          lastActiveAt: new Date('2026-08-15T10:01:00Z'),
          activeSeconds: 10.0004,
        },
        {
          id: 'a-2',
          deviceId: 'device-3',
          app: '=HYPERLINK("x")',
          context: 'a,b',
          startedAt: new Date('2026-08-16T10:00:00Z'),
          lastActiveAt: new Date('2026-08-16T10:01:00Z'),
          activeSeconds: 60,
        },
      ]);
    });

    it('writes rolled and live time per day, device, category, app and context', async () => {
      const whole = await drain('user-1', { format: 'SUMMARIES_CSV' }, 100_000);
      expect(whole.data).toBe(
        [
          'day,device,category,app,context,seconds',
          '2026-06-01,laptop,Work,code,,100.25',
          '2026-08-15,laptop,Work,code,,60',
          `2026-08-16,laptop,,"'=HYPERLINK(""x"")","a,b",60`,
          '',
        ].join('\r\n'),
      );
      // Paged a row at a time, across windows with nothing in them.
      const paged = await drain('user-1', { format: 'SUMMARIES_CSV' }, 1);
      expect(paged.calls).toBeGreaterThan(1);
      expect(paged.data).toBe(whole.data);
    });

    it('limits to the range, and is only a header when it is empty', async () => {
      const { data } = await drain(
        'user-1',
        { format: 'SUMMARIES_CSV', from: '2026-08-15', to: '2026-08-16' },
        100,
      );
      expect(data).toBe(
        'day,device,category,app,context,seconds\r\n2026-08-15,laptop,Work,code,,60\r\n',
      );
      const empty = await drain('user-4', { format: 'SUMMARIES_CSV' }, 100);
      expect(empty.data).toBe('day,device,category,app,context,seconds\r\n');
    });
  });

  it('refuses cursors it did not write, or wrote for another export', async () => {
    const first = await exportChunk(db, 'user-1', { format: 'BUNDLE' }, 2);
    expect(first.next).toBeTruthy();
    const refuse = (args: ExportArgs) =>
      expect(exportChunk(db, 'user-1', args, 2)).rejects.toMatchObject({
        extensions: { code: 'BAD_USER_INPUT' },
      });
    await refuse({ format: 'BUNDLE', cursor: 'not a cursor' });
    await refuse({ format: 'ACTIVITYWATCH', cursor: first.next });
    const aw = await exportChunk(db, 'user-1', { format: 'ACTIVITYWATCH', from: '2026-08-16' }, 2);
    await refuse({ format: 'ACTIVITYWATCH', from: '2026-08-15', cursor: aw.next });
    const forged = (state: unknown) =>
      Buffer.from(JSON.stringify({ v: 1, format: 'BUNDLE', from: null, to: null, state })).toString(
        'base64url',
      );
    await refuse({ format: 'BUNDLE', cursor: forged({ section: 99, after: null, counts: {} }) });
    await refuse({ format: 'BUNDLE', cursor: forged({ section: 5, after: ['x'], counts: {} }) });
    await refuse({ format: 'SUMMARIES_CSV', from: '2026-02-30' });
    await refuse({ format: 'SUMMARIES_CSV', from: '2026-08-02', to: '2026-08-01' });
  });

  it('keeps a forged cursor inside the caller account', async () => {
    // Positioned on the other user's device, mid-log: their pings still don't come back.
    const cursor = Buffer.from(
      JSON.stringify({
        v: 1,
        format: 'BUNDLE',
        from: null,
        to: null,
        state: { section: 8, after: ['device-1', T0.toISOString(), '0'], counts: {} },
      }),
    ).toString('base64url');
    const chunk = await exportChunk(db, 'user-2', { format: 'BUNDLE', cursor }, 100_000);
    expect(chunk.data).not.toContain('device-1');
    expect(chunk.data).toContain('THEIRS');

    const awCursor = Buffer.from(
      JSON.stringify({
        v: 1,
        format: 'ACTIVITYWATCH',
        from: null,
        to: null,
        state: {
          device: 'device-1',
          pass: 'window',
          open: true,
          after: null,
          converter: { prevAt: null, pending: null },
          events: 0,
          buckets: 0,
        },
      }),
    ).toString('base64url');
    const aw = await exportChunk(
      db,
      'user-2',
      { format: 'ACTIVITYWATCH', cursor: awCursor },
      100_000,
    );
    expect(aw.data).not.toContain('eunomia');
    expect(aw.data).not.toContain('laptop');
  });
});
