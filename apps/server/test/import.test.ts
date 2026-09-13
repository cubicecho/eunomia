import { eq } from 'drizzle-orm';
import { graphql } from 'graphql';
import { beforeEach, describe, expect, it } from 'vitest';
import { ingestPings } from '../src/activity/ingest.ts';
import type { RawPing } from '../src/activity/ping-log.ts';
import { rollupActivities } from '../src/activity/rollup.ts';
import {
  activities,
  categories,
  categoryRules,
  contextRules,
  type Device,
  devices,
  mergeRules,
  pings,
  summaries,
  user,
} from '../src/db/schema.ts';
import { type ExportArgs, exportChunk } from '../src/export/chunk.ts';
import type { Context } from '../src/graphql/context.ts';
import { createSchema } from '../src/graphql/schema.ts';
import {
  type AwEvent,
  convertEvents,
  initialConverter,
  MAX_IMPORT_PINGS,
  parseEvent,
} from '../src/import/activitywatch.ts';
import { type ImportArgs, importChunk, MAX_IMPORT_RECORDS } from '../src/import/chunk.ts';
import { csvFields, readHeader } from '../src/import/rescuetime.ts';
import { stubAuthGateway } from './helpers/stub-auth.ts';
import { createMigratedTestDb } from './helpers/test-db.ts';

const T0 = new Date('2026-08-16T20:00:00.000Z');
const at = (seconds: number) => new Date(T0.getTime() + seconds * 1000);
const ms = (seconds: number) => T0.getTime() + seconds * 1000;

const windowEvent = (from: number, to: number, app: string, title: string | null = null) =>
  ({ kind: 'window', start: ms(from), end: ms(to), app, title }) as AwEvent;
const afkEvent = (from: number, to: number, away: boolean) =>
  ({ kind: 'afk', start: ms(from), end: ms(to), away }) as AwEvent;
const webEvent = (from: number, to: number, host: string | null) =>
  ({ kind: 'web', start: ms(from), end: ms(to), host }) as AwEvent;

/** Pings as (seconds from T0, app, context), for reading at a glance. */
const brief = (emitted: RawPing[]) =>
  emitted.map((p) => [(p.capturedAt.getTime() - T0.getTime()) / 1000, p.app, p.context]);

describe('activitywatch events', () => {
  it('reads window, afk and web events, and says why it skips the rest', () => {
    const record = (type: string, data: Record<string, unknown>, extra = {}) =>
      JSON.stringify({ type, timestamp: T0.toISOString(), duration: 1.5, data, ...extra });
    expect(parseEvent(record('currentwindow', { app: ' code ', title: 'a' }))).toEqual({
      kind: 'window',
      start: ms(0),
      end: ms(1.5),
      app: 'code',
      title: 'a',
    });
    expect(parseEvent(record('afkstatus', { status: 'afk' }))).toMatchObject({ away: true });
    expect(parseEvent(record('web.tab.current', { url: 'https://github.com/x?y' }))).toMatchObject({
      kind: 'web',
      host: 'github.com',
    });
    // Not a web page: no site to name.
    expect(parseEvent(record('web.tab.current', { url: 'about:blank' }))).toMatchObject({
      host: null,
    });
    // A day and more is cut to the day.
    expect(parseEvent(record('currentwindow', { app: 'code' }, { duration: 1e9 }))).toMatchObject({
      end: ms(86_400),
    });

    expect(parseEvent('{')).toBe('Unreadable event');
    expect(parseEvent(record('currentwindow', { app: '  ' }))).toBe('Window event without an app');
    expect(parseEvent(record('afkstatus', { status: 'maybe' }))).toBe('AFK event without a status');
    expect(parseEvent(record('app.editor.activity', {}))).toMatch(/^Unsupported bucket type/);
    expect(parseEvent(record('currentwindow', { app: 'code' }, { duration: -1 }))).toBe(
      'Event with an impossible duration',
    );
    for (const timestamp of ['1970-01-01T00:00:00Z', '2999-01-01T00:00:00Z', 'yesterday']) {
      expect(parseEvent(record('currentwindow', { app: 'code' }, { timestamp }))).toBe(
        'Event with an impossible timestamp',
      );
    }
  });

  it('places pings the way an agent watching the screen would have sent them', () => {
    const converter = initialConverter(false);
    expect(
      brief(
        convertEvents(
          converter,
          [
            windowEvent(0, 60, 'code'),
            // Straight on: code's closing ping at 60 credits code, the next one firefox.
            windowEvent(60, 80, 'firefox'),
            // A short silence, then a ping the accrual cap in.
            windowEvent(100, 140, 'code'),
            // A silence past the close threshold: a ping right at the start.
            windowEvent(2000, 2010, 'slack'),
          ],
          true,
        ),
      ),
    ).toEqual([
      [0, 'code', null],
      [25, 'code', null],
      [50, 'code', null],
      [60, 'code', null],
      [80, 'firefox', null],
      [130, 'code', null],
      [140, 'code', null],
      [2000, 'slack', null],
      [2010, 'slack', null],
    ]);
  });

  it('counts only not-afk time, and names the site only for a browser', () => {
    const emitted = convertEvents(
      initialConverter(true),
      [
        afkEvent(0, 50, false),
        windowEvent(0, 100, 'firefox'),
        webEvent(0, 100, 'github.com'),
        afkEvent(50, 100, true),
        // The tab stays current while the editor is in front.
        windowEvent(100, 120, 'code'),
        afkEvent(100, 120, false),
      ],
      true,
    );
    expect(brief(emitted)).toEqual([
      [0, 'firefox', 'github.com'],
      [25, 'firefox', 'github.com'],
      [50, 'firefox', 'github.com'],
      [120, 'code', null],
    ]);
  });

  it('streams across calls into the same pings as one call', () => {
    const events = [
      afkEvent(0, 400, false),
      windowEvent(0, 70, 'code', 'a'),
      webEvent(10, 300, 'example.com'),
      windowEvent(70, 90, 'firefox'),
      windowEvent(90, 95, 'code', 'b'),
      windowEvent(120, 300, 'firefox'),
      afkEvent(300, 1500, true),
      windowEvent(300, 1400, 'code', 'c'),
      afkEvent(1500, 1600, false),
      windowEvent(1500, 1600, 'code', 'c'),
    ].sort((a, b) => a.start - b.start);
    const whole = convertEvents(initialConverter(true), events, true);

    for (const size of [1, 2, 3]) {
      // Through JSON each time, as the cursor carries it.
      let converter = initialConverter(true);
      const streamed: RawPing[] = [];
      for (let i = 0; i < events.length; i += size) {
        streamed.push(
          ...convertEvents(converter, events.slice(i, i + size), i + size >= events.length),
        );
        converter = JSON.parse(JSON.stringify(converter));
      }
      expect(brief(streamed)).toEqual(brief(whole));
    }
  });

  it('refuses a call that would fold an absurd number of pings', () => {
    const day = 86_400;
    expect(() =>
      convertEvents(
        initialConverter(false),
        [
          windowEvent(0, day, 'a'),
          windowEvent(day, 2 * day, 'b'),
          windowEvent(2 * day, 3 * day, 'c'),
        ],
        true,
      ),
    ).toThrow(/Too much activity/);
    expect(MAX_IMPORT_PINGS).toBeLessThan((3 * day) / 25);
  });
});

describe('rescuetime csv', () => {
  it('splits quoted fields and finds columns by name', () => {
    expect(csvFields('a,"b,c","say ""hi""\nthere",\r')).toEqual([
      'a',
      'b,c',
      'say "hi"\nthere',
      '',
    ]);
    expect(readHeader('﻿Date,Time Spent (seconds),Number of People,Activity,Document')).toEqual({
      date: 0,
      amount: 1,
      scale: 1,
      activity: 3,
      document: 4,
    });
    expect(readHeader('Timestamp,Minutes,Application')).toEqual({
      date: 0,
      amount: 1,
      scale: 60,
      activity: 2,
      document: null,
    });
    expect(readHeader('day,device,category,app,context,seconds')).toMatchObject({ activity: 3 });
    expect(readHeader('when,what')).toBeNull();
  });
});

describe('imports', () => {
  let db: Awaited<ReturnType<typeof createMigratedTestDb>>;
  let schema: ReturnType<typeof createSchema>;

  const device = async (id: string): Promise<Device> => {
    const [row] = await db.select().from(devices).where(eq(devices.id, id));
    return row!;
  };

  const query = async (source: string, userId: string) => {
    const result = await graphql({
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
    expect(result.errors).toBeUndefined();
    return result.data as any;
  };

  /** The dashboard's aggregates, without the ids that differ between accounts. */
  const aggregates = async (userId: string, deviceId?: string) => {
    const window = `${deviceId ? `deviceId: "${deviceId}", ` : ''}from: "2026-05-01", to: "2026-09-01"`;
    const data = await query(
      `{
        appSummary(${window}) { app context categoryName seconds }
        categorySummary(${window}) { day name seconds }
        ${deviceId ? '' : 'deviceSummary(from: "2026-05-01", to: "2026-09-01") { name platform seconds }'}
      }`,
      userId,
    );
    const tidy = (rows: Record<string, any>[]) =>
      rows
        .filter((row) => row.seconds > 0)
        .map(
          (row): Record<string, any> => ({
            ...row,
            seconds: Math.round(row.seconds * 1000) / 1000,
          }),
        )
        .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    return {
      apps: tidy(data.appSummary),
      categories: tidy(data.categorySummary),
      devices: data.deviceSummary ? tidy(data.deviceSummary) : null,
    };
  };

  const exported = async (userId: string, args: Omit<ExportArgs, 'cursor'>) => {
    let data = '';
    let cursor: string | null = null;
    do {
      const chunk = await exportChunk(db, userId, { ...args, cursor }, 7);
      data += chunk.data;
      cursor = chunk.next;
    } while (cursor);
    return data;
  };

  /**
   * Sends `records` the way the dashboard does: `size` at a time, the cursor
   * passed along, the target on the first call only, and the file again from
   * the top whenever the server asks.
   */
  const imported = async (
    userId: string,
    source: ImportArgs['source'],
    records: string[],
    size: number,
    target?: ImportArgs['target'],
  ) => {
    const totals = { accepted: 0, skipped: 0, pings: 0, calls: 0, restarts: 0 };
    // Each call reports its own; added up across calls, as the dashboard shows them.
    const warned = new Map<string, number>();
    const deviceIds = new Set<string>();
    let cursor: string | null = null;
    let offset = 0;
    for (;;) {
      const done = offset + size >= records.length;
      const chunk = await importChunk(db, userId, {
        source,
        records: records.slice(offset, offset + size),
        cursor,
        target: cursor ? null : target,
        done,
      });
      totals.accepted += chunk.accepted;
      totals.skipped += chunk.skipped;
      totals.pings += chunk.pings;
      totals.calls += 1;
      for (const warning of chunk.warnings) {
        const [, reason, times] = warning.match(/^(.*?)(?: \(×(\d+)\))?$/s)!;
        warned.set(reason!, (warned.get(reason!) ?? 0) + Number(times ?? 1));
      }
      for (const id of chunk.deviceIds) deviceIds.add(id);
      expect(totals.calls).toBeLessThan(10_000);
      if (!chunk.next) break;
      cursor = chunk.next;
      if (chunk.restart) {
        totals.restarts += 1;
        offset = 0;
      } else {
        expect(done).toBe(false);
        offset += size;
      }
    }
    const warnings = [...warned].map(([reason, n]) => (n === 1 ? reason : `${reason} (×${n})`));
    return { ...totals, warnings, deviceIds: [...deviceIds] };
  };

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

  /** user-1's rules, for an account that should fold pings the same way. */
  const copyRules = async (userId: string) => {
    await db.insert(categories).values({ id: `${userId}-work`, userId, name: 'Work' });
    await db.insert(categoryRules).values({
      id: `${userId}-rule`,
      userId,
      categoryId: `${userId}-work`,
      appPattern: '^code$',
    });
    await db
      .insert(contextRules)
      .values({ id: `${userId}-ctx`, userId, titlePattern: '^(\\w+) —' });
    await db
      .insert(mergeRules)
      .values({ id: `${userId}-merge`, userId, fromApp: 'Code', toApp: 'code' });
  };

  beforeEach(async () => {
    db = await createMigratedTestDb();
    schema = createSchema(db as never, stubAuthGateway());
    await db.insert(user).values([
      { id: 'user-1', name: 'u', email: 'u@example.com' },
      { id: 'user-2', name: 'v', email: 'v@example.com' },
      { id: 'user-3', name: 'w', email: 'w@example.com' },
    ]);
    await db.insert(devices).values([
      { id: 'device-1', userId: 'user-1', name: 'laptop', platform: 'linux' },
      { id: 'device-2', userId: 'user-2', name: 'theirs', platform: 'windows' },
      { id: 'device-3', userId: 'user-1', name: 'phone', platform: 'android' },
    ]);
    await copyRules('user-1');

    await ingestPings(db, await device('device-1'), [
      ...sessionPings(
        0,
        [
          ['code', 'eunomia — fold.ts'],
          ['code', 'eunomia — fold.ts'],
          ['firefox', 'Inbox'],
          ['firefox', 'Inbox'],
          ['Code', 'eunomia — ingest.ts'],
        ],
        14,
      ),
      // A short gap, then on without an idle tail.
      ...sessionPings(400, [
        ['code', 'other — index.ts'],
        ['code', 'other — index.ts'],
        ['code', 'other — index.ts'],
      ]),
      ...sessionPings(18_000, [
        ['code', 'other — index.ts'],
        ['slack', 'general'],
        ['slack', 'general'],
        ['slack', 'general'],
      ]),
    ]);
    await ingestPings(
      db,
      await device('device-2'),
      sessionPings(0, [
        ['steam', 'x'],
        ['steam', 'x'],
      ]),
    );
    await rollupActivities(db);
  });

  describe('activitywatch', () => {
    /** The records the dashboard sends for one host of an aw-server export. */
    const awRecords = (document: string, hostname: string) => {
      const buckets = Object.values(JSON.parse(document).buckets) as {
        type: string;
        hostname: string;
        events: { timestamp: string }[];
      }[];
      const mine = buckets.filter((bucket) => bucket.hostname === hostname);
      const events = mine
        .flatMap((bucket) => bucket.events.map((event) => ({ type: bucket.type, ...event })))
        .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
      return [
        JSON.stringify({
          format: 'activitywatch',
          afk: mine.some((bucket) => bucket.type === 'afkstatus'),
        }),
        ...events.map((event) => JSON.stringify(event)),
      ];
    };

    it('folds this server’s own export back into the same time', async () => {
      const records = awRecords(await exported('user-1', { format: 'ACTIVITYWATCH' }), 'laptop');
      expect(records.length).toBeGreaterThan(5);
      await copyRules('user-3');

      for (const size of [2, 1000]) {
        const result = await imported('user-3', 'ACTIVITYWATCH', records, size, {
          newDeviceName: `laptop ${size}`,
          platform: 'linux',
        });
        expect(result).toMatchObject({ skipped: 0, restarts: 0, warnings: [] });
        expect(result.pings).toBeGreaterThan(0);
        expect(result.deviceIds).toHaveLength(1);
        const [created] = result.deviceIds;
        expect(await device(created!)).toMatchObject({ userId: 'user-3', platform: 'linux' });
        await rollupActivities(db);
        expect(await aggregates('user-3', created)).toEqual(await aggregates('user-1', 'device-1'));
      }
    });

    it('turns a site in the browser into its context', async () => {
      const event = (type: string, from: number, duration: number, data: object) =>
        JSON.stringify({ type, timestamp: at(from).toISOString(), duration, data });
      const result = await imported(
        'user-3',
        'ACTIVITYWATCH',
        [
          JSON.stringify({ format: 'activitywatch', afk: false }),
          event('currentwindow', 0, 60, { app: 'code', title: 'x' }),
          event('web.tab.current', 0, 200, { url: 'https://github.com/cubicecho', title: 'gh' }),
          event('currentwindow', 60, 40, { app: 'Firefox', title: 'GitHub' }),
          // Zero-length, as aw-server leaves behind: accepted, covers nothing.
          event('currentwindow', 70, 0, { app: 'slack' }),
          'garbage',
          event('afkstatus', 80, 5, { status: 'sleepy' }),
        ],
        3,
        { newDeviceName: 'imported', platform: 'macos' },
      );
      expect(result).toMatchObject({ accepted: 4, skipped: 2 });
      expect(result.warnings).toEqual(['Unreadable event', 'AFK event without a status']);
      const { apps } = await aggregates('user-3', result.deviceIds[0]);
      expect(apps).toEqual([
        { app: 'code', context: null, categoryName: null, seconds: 60 },
        { app: 'Firefox', context: 'github.com', categoryName: null, seconds: 40 },
      ]);
    });

    it('rebuilds an existing device when the history goes before what it has', async () => {
      // Recorded live an hour after what the import brings.
      await ingestPings(
        db,
        await device('device-3'),
        sessionPings(3600, [
          ['vim', 'a'],
          ['vim', 'a'],
        ]),
      );
      const event = (from: number, duration: number, app: string) =>
        JSON.stringify({
          type: 'currentwindow',
          timestamp: at(from).toISOString(),
          duration,
          data: { app },
        });
      const result = await imported(
        'user-1',
        'ACTIVITYWATCH',
        [JSON.stringify({ format: 'activitywatch', afk: false }), event(0, 100, 'emacs')],
        10,
        { deviceId: 'device-3' },
      );
      expect(result.deviceIds).toEqual(['device-3']);
      // Replayed when the import finished, not left for the timer.
      expect((await device('device-3')).replayFrom).toBeNull();
      expect((await aggregates('user-1', 'device-3')).apps).toEqual([
        { app: 'emacs', context: null, categoryName: null, seconds: 100 },
        { app: 'vim', context: null, categoryName: null, seconds: 10 },
      ]);
    });

    it('leaves out history from before a pruned log, and says so', async () => {
      await db
        .update(devices)
        .set({ pingLogFrom: at(50) })
        .where(eq(devices.id, 'device-3'));
      const result = await imported(
        'user-1',
        'ACTIVITYWATCH',
        [
          JSON.stringify({ format: 'activitywatch', afk: false }),
          JSON.stringify({
            type: 'currentwindow',
            timestamp: at(0).toISOString(),
            duration: 100,
            data: { app: 'emacs' },
          }),
        ],
        10,
        { deviceId: 'device-3' },
      );
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toMatch(/^Pings from before 2026-08-16.*\(×2\)$/);
      expect(result.pings).toBe(3);
    });

    it('refuses what it cannot apply', async () => {
      const refuse = (args: ImportArgs, message: RegExp) =>
        expect(importChunk(db, 'user-1', args)).rejects.toMatchObject({
          message: expect.stringMatching(message),
          extensions: { code: 'BAD_USER_INPUT' },
        });
      const header = JSON.stringify({ format: 'activitywatch', afk: false });
      await refuse({ source: 'ACTIVITYWATCH', records: [header] }, /Pick a device/);
      await refuse(
        { source: 'ACTIVITYWATCH', records: ['{}'], target: { deviceId: 'device-1' } },
        /first record must be its header/,
      );
      await refuse(
        {
          source: 'ACTIVITYWATCH',
          records: [header],
          target: { deviceId: 'device-1', newDeviceName: 'x', platform: 'linux' },
        },
        /not both/,
      );
      await refuse(
        { source: 'ACTIVITYWATCH', records: [header], target: { newDeviceName: '  ' } },
        /Name the device/,
      );
      await refuse(
        {
          source: 'ACTIVITYWATCH',
          records: [header],
          target: { newDeviceName: 'x', platform: 'beos' },
        },
        /Unknown platform/,
      );
      await refuse(
        {
          source: 'ACTIVITYWATCH',
          records: Array(MAX_IMPORT_RECORDS + 1).fill(header),
          target: { deviceId: 'device-1' },
        },
        /Too many records/,
      );
      await refuse(
        {
          source: 'ACTIVITYWATCH',
          records: ['x'.repeat(70_000)],
          target: { deviceId: 'device-1' },
        },
        /longer than/,
      );

      const first = await importChunk(db, 'user-1', {
        source: 'ACTIVITYWATCH',
        records: [header],
        target: { deviceId: 'device-1' },
      });
      expect(first.next).toBeTruthy();
      await refuse(
        {
          source: 'ACTIVITYWATCH',
          records: [],
          cursor: first.next,
          target: { deviceId: 'device-3' },
        },
        /only given on the first call/,
      );
      await refuse({ source: 'RESCUETIME', records: [], cursor: first.next }, /different import/);
      await refuse(
        { source: 'ACTIVITYWATCH', records: [], cursor: 'garbage' },
        /Invalid import cursor/,
      );
      const forged = Buffer.from(
        JSON.stringify({ v: 1, source: 'ACTIVITYWATCH', state: { deviceId: 'device-1' } }),
      ).toString('base64url');
      await refuse(
        { source: 'ACTIVITYWATCH', records: [], cursor: forged },
        /Invalid import cursor/,
      );

      // A failed call leaves nothing behind — not even the device it would have made.
      const before = await db.select().from(devices);
      await refuse(
        {
          source: 'ACTIVITYWATCH',
          records: ['{}'],
          target: { newDeviceName: 'x', platform: 'linux' },
        },
        /header/,
      );
      expect(await db.select().from(devices)).toHaveLength(before.length);
    });
  });

  describe('bundle', () => {
    beforeEach(async () => {
      await db.update(user).set({ timeZone: 'America/Chicago' }).where(eq(user.id, 'user-1'));
      // History from before the log began, held only as a summary.
      await db
        .update(devices)
        .set({ pingLogFrom: at(-86_400) })
        .where(eq(devices.id, 'device-1'));
      await db.insert(summaries).values({
        id: 'old',
        deviceId: 'device-1',
        day: '2026-06-01',
        app: 'code',
        categoryId: 'user-1-work',
        seconds: 5000,
      });
      // A manual assignment, made the way the dashboard makes one.
      await db.insert(categories).values({ id: 'mail', userId: 'user-1', name: 'Mail' });
      const [firefox] = await db.select().from(activities).where(eq(activities.app, 'firefox'));
      await query(
        `mutation { assignActivity(activityId: "${firefox!.id}", categoryId: "mail") { id } }`,
        'user-1',
      );
    });

    const bundle = async () =>
      (await exported('user-1', { format: 'BUNDLE' })).trimEnd().split('\n');

    it('restores into a fresh account with the same dashboard', async () => {
      const lines = await bundle();
      const result = await imported('user-3', 'BUNDLE', lines, 4);
      expect(result.restarts).toBe(1);
      expect(result.skipped).toBe(0);
      expect(result.warnings).toEqual([]);
      await rollupActivities(db);

      const [mine, restored] = [await aggregates('user-1'), await aggregates('user-3')];
      expect(restored).toEqual(mine);
      expect(mine.categories.map((row) => row.name)).toContain('Mail');
      expect(mine.categories.some((row) => row.day === '2026-06-01')).toBe(true);

      const [profile] = await db.select().from(user).where(eq(user.id, 'user-3'));
      expect(profile).toMatchObject({ timeZone: 'America/Chicago', email: 'w@example.com' });
      // Keys never travel: restored devices have none.
      const created = await db.select().from(devices).where(eq(devices.userId, 'user-3'));
      expect(created.map((d) => d.name).sort()).toEqual(['laptop', 'phone']);
      const [original] = await db.select().from(pings).where(eq(pings.deviceId, 'device-1'));
      expect(original).toBeDefined();
    });

    it('restores category kinds, and reads bundles written before kinds', async () => {
      await db.update(categories).set({ kind: 'focus' }).where(eq(categories.id, 'user-1-work'));
      await db.update(categories).set({ kind: 'distracting' }).where(eq(categories.id, 'mail'));
      const lines = (await bundle()).map((line) => {
        const record = JSON.parse(line);
        if (record.type !== 'category') return line;
        expect(record.kind).toBeDefined();
        // Mail as an older server wrote it, with no kind at all.
        if (record.id === 'mail') delete record.kind;
        return JSON.stringify(record);
      });
      const result = await imported('user-3', 'BUNDLE', lines, 50);
      expect(result.skipped).toBe(0);
      const restored = await db
        .select({ name: categories.name, kind: categories.kind })
        .from(categories)
        .where(eq(categories.userId, 'user-3'));
      expect(restored.sort((a, b) => a.name.localeCompare(b.name))).toEqual([
        { name: 'Mail', kind: 'neutral' },
        { name: 'Work', kind: 'focus' },
      ]);
    });

    it('restores the same way however it is chunked', async () => {
      const lines = await bundle();
      await imported('user-3', 'BUNDLE', lines, 1000);
      await rollupActivities(db);
      expect(await aggregates('user-3')).toEqual(await aggregates('user-1'));
    });

    it('keeps the caller’s own zone, and does not duplicate what they already have', async () => {
      await db.update(user).set({ timeZone: 'UTC' }).where(eq(user.id, 'user-3'));
      const lines = await bundle();
      await imported('user-3', 'BUNDLE', lines, 50);
      const again = await imported('user-3', 'BUNDLE', lines, 50);
      expect(again.warnings).toContain('Kept your own time zone rather than the bundle’s');
      expect(again.warnings).toContain('Merge rule for an entry you already merge');

      const [profile] = await db.select().from(user).where(eq(user.id, 'user-3'));
      expect(profile!.timeZone).toBe('UTC');
      const count = async (table: typeof categories | typeof categoryRules | typeof contextRules) =>
        (await db.select().from(table).where(eq(table.userId, 'user-3'))).length;
      expect(await count(categories)).toBe(2);
      expect(await count(categoryRules)).toBe(1);
      expect(await count(contextRules)).toBe(1);
      // Devices are always new: a second restore is a second copy of the history.
      expect(await db.select().from(devices).where(eq(devices.userId, 'user-3'))).toHaveLength(4);
    });

    it('skips what is malformed, and refuses a file it cannot restore', async () => {
      const lines = await bundle();
      const tampered = [
        ...lines.slice(0, -1),
        '{not json',
        JSON.stringify({
          type: 'ping',
          deviceId: 'nope',
          capturedAt: T0.toISOString(),
          idleSeconds: 0,
        }),
        JSON.stringify({ type: 'categoryRule', categoryId: 'user-1-work', appPattern: '(a+)+$' }),
        JSON.stringify({ type: 'wormhole' }),
        lines.at(-1)!,
      ];
      const result = await imported('user-3', 'BUNDLE', tampered, 5);
      expect(result.warnings).toEqual(
        expect.arrayContaining([
          expect.stringMatching(/^Unreadable line/),
          'Ping for a device that was not restored',
          'Unknown record type: wormhole',
        ]),
      );

      const refuse = (args: ImportArgs, message: RegExp) =>
        expect(importChunk(db, 'user-3', args)).rejects.toMatchObject({
          message: expect.stringMatching(message),
          extensions: { code: 'BAD_USER_INPUT' },
        });
      await refuse({ source: 'BUNDLE', records: lines.slice(1) }, /must start with its header/);
      await refuse({ source: 'BUNDLE', records: lines.slice(0, -1), done: true }, /ends early/);
      await refuse(
        {
          source: 'BUNDLE',
          records: [JSON.stringify({ format: 'eunomia-export', version: 99 })],
        },
        /newer than this server reads/,
      );
    });

    it('writes nothing outside the caller’s account, whatever the cursor says', async () => {
      const theirPings = await db.select().from(pings).where(eq(pings.deviceId, 'device-2'));
      const forged = Buffer.from(
        JSON.stringify({
          v: 1,
          source: 'BUNDLE',
          state: {
            phase: 'records',
            header: true,
            devices: { mine: 'device-2' },
            categories: { work: 'user-1-work' },
          },
        }),
      ).toString('base64url');
      const result = await importChunk(db, 'user-3', {
        source: 'BUNDLE',
        cursor: forged,
        records: [
          JSON.stringify({
            type: 'ping',
            deviceId: 'mine',
            capturedAt: at(9000).toISOString(),
            app: 'x',
            idleSeconds: 0,
          }),
          JSON.stringify({ type: 'categoryRule', categoryId: 'work', appPattern: 'x' }),
        ],
      });
      expect(result.warnings).toEqual([
        'Ping for a device that was not restored',
        'Category rule for a category that was not restored',
      ]);
      expect(await db.select().from(pings).where(eq(pings.deviceId, 'device-2'))).toHaveLength(
        theirPings.length,
      );
      expect(await db.select().from(categoryRules)).toHaveLength(1);
    });
  });

  describe('rescuetime', () => {
    it('adds daily time per activity, resolved by the caller’s rules', async () => {
      const result = await imported(
        'user-1',
        'RESCUETIME',
        [
          '﻿Date,Time Spent (seconds),Number of People,Activity,Document,Category,Productivity',
          '2026-07-01T09:00:00,600,1,Code,eunomia — fold.ts,Software Development,2',
          '2026-07-01T10:00:00,300,1,code,"eunomia — a, b.ts",Software Development,2',
          '2026-07-01T10:00:00,120,1,"Slack, Inc.",,Communication,0',
          '2026-07-02T10:00:00,60,1,code,,Software Development,2',
          '',
          '1999-12-31T10:00:00,60,1,code,,x,0',
          'yesterday,60,1,code,,x,0',
          '2026-07-02T10:00:00,90000,1,code,,x,0',
          '2026-07-02T10:00:00,,1,code,,x,0',
          '2026-07-02T10:00:00,60,1,,,x,0',
        ],
        3,
        { deviceId: 'device-3' },
      );
      expect(result).toMatchObject({ accepted: 4, skipped: 5, pings: 0 });
      expect(result.warnings).toEqual([
        'Row with an impossible date (×2)',
        'Row with an impossible duration (×2)',
        'Row without an activity',
      ]);
      const rows = await db
        .select({
          day: summaries.day,
          app: summaries.app,
          context: summaries.context,
          categoryId: summaries.categoryId,
          seconds: summaries.seconds,
        })
        .from(summaries)
        .where(eq(summaries.deviceId, 'device-3'));
      expect(rows.sort((a, b) => `${a.day}${a.app}`.localeCompare(`${b.day}${b.app}`))).toEqual([
        {
          day: '2026-07-01',
          app: 'code',
          context: 'eunomia',
          categoryId: 'user-1-work',
          seconds: 900,
        },
        { day: '2026-07-01', app: 'Slack, Inc.', context: null, categoryId: null, seconds: 120 },
        { day: '2026-07-02', app: 'code', context: null, categoryId: 'user-1-work', seconds: 60 },
      ]);
    });

    it('needs its header first', async () => {
      await expect(
        importChunk(db, 'user-1', {
          source: 'RESCUETIME',
          records: ['2026-07-01,600,code'],
          target: { deviceId: 'device-3' },
        }),
      ).rejects.toThrow(/Not a RescueTime export/);
    });
  });
});
