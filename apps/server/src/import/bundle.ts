import { and, eq, inArray, sql } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import { z } from 'zod';
import { assertValidContextPattern } from '../activity/context.ts';
import { type FoldRules, ingestPings, loadFoldRules } from '../activity/ingest.ts';
import { type Entry, loadMergeRules, mergeEntry, sameEntry } from '../activity/merge-rules.ts';
import type { RawPing } from '../activity/ping-log.ts';
import { replayDevice } from '../activity/replay.ts';
import { addSeconds, moveRolledSeconds, ownerZone } from '../activity/rollup.ts';
import { assertValidPattern } from '../activity/rules.ts';
import { setUserTimeZone } from '../activity/time-zone.ts';
import type { Db } from '../db/client.ts';
import {
  activities,
  CATEGORY_KINDS,
  categories,
  categoryRules,
  contextRules,
  type Device,
  devices,
  mergeRules,
  pings,
  user,
} from '../db/schema.ts';
import { badInput } from '../errors.ts';
import { BUNDLE_FORMAT, BUNDLE_VERSION } from '../export/bundle.ts';
import { isCalendarDay } from '../graphql/summaries.ts';
import { type Importer, MAX_FIELD_LENGTH, plausibleInstant, type Tally } from './importer.ts';

// Restoring an account bundle (export/bundle.ts) into the caller's account —
// always the caller's, whatever user the file came from: the profile's id,
// name and email are never read, and every row is created fresh under new ids.
//
// What is restored, and how:
//
// - The time zone, when the caller hasn't chosen one of their own. It goes
//   first because it decides which day every restored second lands on.
// - Categories, matched to the caller's existing ones by name, so restoring
//   into an account that already has "Work" doesn't make a second one. Rules
//   are skipped when an identical one exists; merge rules when the caller
//   already merges that entry somewhere.
// - Devices, always new, and without keys: keys never leave the server that
//   issued them, so a restored device records nothing until an agent is paired
//   with it (or its history is merged into a device that has one).
// - The raw ping log, fed through ingestPings like any upload. Activities and
//   focus segments are rebuilt by the fold rather than copied, so they come
//   out consistent with the rules as they are here, and replay keeps working
//   on them afterwards.
// - Summaries only for the days a device's log doesn't reach: rows before the
//   log began (pingLogFrom) or since pruned. Days the pings cover are rebuilt
//   from the pings and rolled up again; restoring their summaries too would
//   count them twice. Activities that weren't rolled up yet and start before
//   the log are added as summaries on the same terms.
// - Manual category assignments, onto the rebuilt activity with the same app,
//   context and start — the same match replay uses to carry them.
//
// Summaries and activities come BEFORE pings in a bundle, but whether one is
// needed depends on where the pings begin. So a restore reads the file twice:
// the first pass restores everything up to and including the pings and asks
// for the file again (`restart`); the second reads only summaries and
// activities, now knowing each device's first ping.

/** Ids remembered across calls, per kind — far beyond any real account. */
const MAX_MAPPED = 1000;

/** Pings per ingestPings call. */
const INGEST_BATCH = 1000;

/** A summary row is one app on one device on one day — a day and change, at most. */
const MAX_SUMMARY_SECONDS = 2 * 86_400;

/** A string field as it was recorded: kept verbatim, cut to MAX_FIELD_LENGTH. */
const text = z
  .string()
  .transform((value) => value.slice(0, MAX_FIELD_LENGTH))
  .nullable()
  .optional()
  .transform((value) => value ?? null);

/** A required name: non-blank. */
const name = z
  .string()
  .transform((value) => value.slice(0, MAX_FIELD_LENGTH))
  .refine((value) => value.trim() !== '');

const id = z.string().min(1).max(200);

const instant = z
  .string()
  .transform((value) => Date.parse(value))
  .refine(plausibleInstant);

const pattern = z.string().max(MAX_FIELD_LENGTH).nullable().optional();

const RECORDS = {
  profile: z.object({ timeZone: z.string().max(100).nullable().optional() }),
  device: z.object({
    id,
    name,
    platform: z.enum(['windows', 'macos', 'linux', 'android']),
    createdAt: instant.optional(),
  }),
  category: z.object({
    id,
    name,
    color: z.string().max(100).nullable().optional(),
    // Absent from bundles written before categories had kinds, which restore
    // as neutral — as those categories were migrated. An unknown kind (a
    // newer server's) is neutral too, rather than costing the whole category.
    kind: z.enum(CATEGORY_KINDS).optional().catch(undefined),
  }),
  categoryRule: z.object({
    categoryId: id,
    appPattern: pattern,
    titlePattern: pattern,
    contextPattern: pattern,
    priority: z.number().int().min(-1_000_000).max(1_000_000).optional(),
  }),
  contextRule: z.object({
    appPattern: pattern,
    titlePattern: z.string().max(MAX_FIELD_LENGTH),
    priority: z.number().int().min(-1_000_000).max(1_000_000).optional(),
  }),
  mergeRule: z.object({ fromApp: name, fromContext: text, toApp: name, toContext: text }),
  ping: z.object({
    deviceId: id,
    capturedAt: instant,
    app: text,
    title: text,
    context: text,
    idleSeconds: z.number().min(0).max(1e7),
  }),
  summary: z.object({
    deviceId: id,
    day: z.string().refine(isCalendarDay),
    app: name,
    context: text,
    categoryId: id.nullable(),
    seconds: z.number().min(0).max(MAX_SUMMARY_SECONDS),
  }),
  activity: z.object({
    deviceId: id,
    app: name,
    context: text,
    startedAt: instant,
    activeSeconds: z.number().min(0).max(MAX_SUMMARY_SECONDS),
    categoryId: id.nullable(),
    categorySource: z.enum(['manual', 'rule']).nullable(),
    rolledUp: z.boolean(),
  }),
};

type RecordType = keyof typeof RECORDS;
type RecordOf<T extends RecordType> = z.infer<(typeof RECORDS)[T]>;

const headerSchema = z.object({
  format: z.literal(BUNDLE_FORMAT),
  version: z.number().int().min(1),
});

const idMap = z
  .record(z.string(), z.string())
  .refine((map) => Object.keys(map).length <= MAX_MAPPED);

const restoreState = z.object({
  phase: z.enum(['records', 'summaries']),
  /** Whether the header has been read (first pass only). */
  header: z.boolean(),
  /** The file's ids → the rows created or matched for them here. */
  devices: idMap,
  categories: idMap,
});

type RestoreState = z.infer<typeof restoreState>;

/**
 * Drops the mapped ids that aren't the caller's rows — the cursor round-trips
 * through the client, so this is the fence: a forged mapping can only name
 * rows the caller already owns, and a device or category deleted mid-restore
 * is forgotten rather than written to.
 */
async function fence(
  db: Db,
  userId: string,
  map: Record<string, string>,
  table: PgTable & { id: PgColumn; userId: PgColumn },
): Promise<void> {
  const ids = [...new Set(Object.values(map))];
  if (ids.length === 0) return;
  const owned = new Set(
    (
      await db
        .select({ id: table.id })
        .from(table as PgTable)
        .where(and(eq(table.userId, userId), inArray(table.id, ids)))
    ).map((row) => row.id as string),
  );
  for (const [from, to] of Object.entries(map)) if (!owned.has(to)) delete map[from];
}

/** What a record is: its parsed fields, or why it was skipped. */
function parseRecord(record: string): { type: string; value: unknown } | string {
  let value: unknown;
  try {
    value = JSON.parse(record);
  } catch {
    return 'Unreadable line';
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return 'Unreadable line';
  }
  const type = (value as { type?: unknown }).type;
  return { type: typeof type === 'string' ? type : '', value };
}

function read<T extends RecordType>(type: T, value: unknown): RecordOf<T> | null {
  const parsed = RECORDS[type].safeParse(value);
  return parsed.success ? (parsed.data as RecordOf<T>) : null;
}

/** Whether `check` accepts a pattern, without its BAD_USER_INPUT escaping. */
function valid(check: (pattern: string) => void, ...patterns: (string | null | undefined)[]) {
  try {
    for (const p of patterns) if (p != null) check(p);
    return true;
  } catch {
    return false;
  }
}

/** The calls' shared context: whose restore, where its ids point, what it counted. */
interface Restore {
  db: Db;
  userId: string;
  state: RestoreState;
  tally: Tally;
}

export const bundleImporter: Importer<RestoreState> = {
  state: restoreState,
  targeted: false,
  begin: () => ({ phase: 'records', header: false, devices: {}, categories: {} }),
  async apply(db, { userId, state, records, done, tally }) {
    await fence(db, userId, state.devices, devices);
    await fence(db, userId, state.categories, categories);
    const restore: Restore = { db, userId, state, tally };
    const deviceIds = () => [...new Set(Object.values(state.devices))];

    if (state.phase === 'records') {
      const ended = await restoreRecords(restore, records);
      if (ended) {
        // Replay now rather than when the restore finishes: the second pass
        // pins manual assignments to rebuilt activities by their start, and a
        // replay afterwards would rebuild them again (carrying the pins, but
        // only by the same match).
        const pending = await db
          .select({ id: devices.id })
          .from(devices)
          .where(and(inArray(devices.id, deviceIds()), sql`${devices.replayFrom} is not null`));
        for (const device of pending) await replayDevice(db, device.id);
        return {
          state: { ...state, phase: 'summaries' },
          deviceIds: deviceIds(),
          restart: true,
        };
      }
      if (done) throw badInput('The bundle ends early — it has no end record; was it cut short?');
      return { state, deviceIds: deviceIds() };
    }

    const ended = await restoreHistory(restore, records);
    if (!ended && done) {
      throw badInput('The bundle ends early — it has no end record; was it cut short?');
    }
    return { state: ended ? null : state, deviceIds: deviceIds() };
  },
};

/** The first pass. Returns whether the end record was reached. */
async function restoreRecords({ db, userId, state, tally }: Restore, records: readonly string[]) {
  let rules: FoldRules | null = null;
  const owned = new Map<string, Device>();
  let batch: { device: Device; pings: RawPing[] } | null = null;

  const flush = async () => {
    if (!batch) return;
    rules ??= await loadFoldRules(db, userId);
    await ingestPings(db, batch.device, batch.pings, rules);
    tally.pings += batch.pings.length;
    batch = null;
  };
  const deviceRow = async (fileId: string): Promise<Device | null> => {
    const mapped = state.devices[fileId];
    if (!mapped) return null;
    let row = owned.get(mapped);
    if (!row) {
      [row] = await db.select().from(devices).where(eq(devices.id, mapped));
      if (row) owned.set(mapped, row);
    }
    return row ?? null;
  };

  for (const record of records) {
    const parsed = parseRecord(record);
    if (typeof parsed === 'string') {
      tally.skip(parsed);
      continue;
    }
    const { type, value } = parsed;

    if (!state.header) {
      const header = headerSchema.safeParse(value);
      if (!header.success) {
        throw badInput('Not a eunomia export: the file must start with its header line');
      }
      if (header.data.version > BUNDLE_VERSION) {
        throw badInput(
          `This export is format version ${header.data.version}, newer than this server reads (${BUNDLE_VERSION})`,
        );
      }
      state.header = true;
      continue;
    }

    if (type === 'ping') {
      const ping = read('ping', value);
      const device = ping && (await deviceRow(ping.deviceId));
      if (!ping || !device) {
        tally.skip(ping ? 'Ping for a device that was not restored' : 'Malformed ping');
        continue;
      }
      if (batch && (batch.device.id !== device.id || batch.pings.length >= INGEST_BATCH)) {
        await flush();
      }
      batch ??= { device, pings: [] };
      batch.pings.push({
        capturedAt: new Date(ping.capturedAt),
        app: ping.app,
        title: ping.title,
        context: ping.context,
        idleSeconds: ping.idleSeconds,
      });
      tally.accepted += 1;
      continue;
    }
    await flush();

    switch (type) {
      case 'end':
        return true;
      case 'profile': {
        const profile = read('profile', value);
        if (!profile) tally.skip('Malformed profile');
        else if (profile.timeZone) await restoreTimeZone(db, userId, profile.timeZone, tally);
        else tally.accepted += 1;
        break;
      }
      case 'device': {
        const device = read('device', value);
        if (!device) tally.skip('Malformed device');
        else if (state.devices[device.id]) tally.accepted += 1;
        else if (Object.keys(state.devices).length >= MAX_MAPPED) tally.skip('Too many devices');
        else {
          const [row] = await db
            .insert(devices)
            .values({
              id: crypto.randomUUID(),
              userId,
              name: device.name.trim().slice(0, 200),
              platform: device.platform,
              ...(device.createdAt ? { createdAt: new Date(device.createdAt) } : {}),
            })
            .returning();
          state.devices[device.id] = row!.id;
          owned.set(row!.id, row!);
          tally.accepted += 1;
        }
        break;
      }
      case 'category': {
        const category = read('category', value);
        if (!category) tally.skip('Malformed category');
        else if (state.categories[category.id]) tally.accepted += 1;
        else if (Object.keys(state.categories).length >= MAX_MAPPED) {
          tally.skip('Too many categories');
        } else {
          const label = category.name.trim().slice(0, 200);
          const [existing] = await db
            .select({ id: categories.id })
            .from(categories)
            .where(and(eq(categories.userId, userId), eq(categories.name, label)));
          const [row] = existing
            ? [existing]
            : await db
                .insert(categories)
                .values({
                  id: crypto.randomUUID(),
                  userId,
                  name: label,
                  color: category.color,
                  kind: category.kind ?? 'neutral',
                })
                .returning({ id: categories.id });
          state.categories[category.id] = row!.id;
          tally.accepted += 1;
        }
        break;
      }
      case 'categoryRule': {
        const rule = read('categoryRule', value);
        const categoryId = rule && state.categories[rule.categoryId];
        const patterns = rule ? [rule.appPattern, rule.titlePattern, rule.contextPattern] : [];
        if (!rule) tally.skip('Malformed category rule');
        else if (!categoryId) tally.skip('Category rule for a category that was not restored');
        else if (patterns.every((p) => p == null) || !valid(assertValidPattern, ...patterns)) {
          tally.skip('Category rule with an invalid pattern');
        } else {
          const values = {
            categoryId,
            appPattern: rule.appPattern ?? null,
            titlePattern: rule.titlePattern ?? null,
            contextPattern: rule.contextPattern ?? null,
          };
          const [same] = await db
            .select({ id: categoryRules.id })
            .from(categoryRules)
            .where(
              and(
                eq(categoryRules.userId, userId),
                eq(categoryRules.categoryId, categoryId),
                sql`${categoryRules.appPattern} is not distinct from ${values.appPattern}`,
                sql`${categoryRules.titlePattern} is not distinct from ${values.titlePattern}`,
                sql`${categoryRules.contextPattern} is not distinct from ${values.contextPattern}`,
              ),
            )
            .limit(1);
          if (!same) {
            await db.insert(categoryRules).values({
              id: crypto.randomUUID(),
              userId,
              ...values,
              priority: rule.priority ?? 0,
            });
            rules = null;
          }
          tally.accepted += 1;
        }
        break;
      }
      case 'contextRule': {
        const rule = read('contextRule', value);
        if (!rule) tally.skip('Malformed context rule');
        else if (
          !valid(assertValidPattern, rule.appPattern) ||
          !valid(assertValidContextPattern, rule.titlePattern)
        ) {
          tally.skip('Context rule with an invalid pattern');
        } else {
          const appPattern = rule.appPattern ?? null;
          const [same] = await db
            .select({ id: contextRules.id })
            .from(contextRules)
            .where(
              and(
                eq(contextRules.userId, userId),
                eq(contextRules.titlePattern, rule.titlePattern),
                sql`${contextRules.appPattern} is not distinct from ${appPattern}`,
              ),
            )
            .limit(1);
          if (!same) {
            await db.insert(contextRules).values({
              id: crypto.randomUUID(),
              userId,
              appPattern,
              titlePattern: rule.titlePattern,
              priority: rule.priority ?? 0,
            });
            rules = null;
          }
          tally.accepted += 1;
        }
        break;
      }
      case 'mergeRule': {
        const rule = read('mergeRule', value);
        const reason = rule ? await restoreMergeRule(db, userId, rule) : 'Malformed merge rule';
        if (reason) tally.skip(reason);
        else {
          rules = null;
          tally.accepted += 1;
        }
        break;
      }
      // Read on the second pass (summary, activity), or rebuilt rather than
      // restored (focusSegment).
      case 'summary':
      case 'activity':
      case 'focusSegment':
        break;
      default:
        tally.skip(`Unknown record type: ${type.slice(0, 40) || '(none)'}`);
    }
  }
  await flush();
  return false;
}

/**
 * The bundle's zone, if the caller has none of their own. An account that
 * already chose a zone keeps it — the restore shouldn't move every day the
 * caller already has onto someone else's midnight.
 */
async function restoreTimeZone(db: Db, userId: string, timeZone: string, tally: Tally) {
  const [current] = await db
    .select({ timeZone: user.timeZone })
    .from(user)
    .where(eq(user.id, userId));
  if (current?.timeZone) {
    if (current.timeZone !== timeZone) {
      tally.skip('Kept your own time zone rather than the bundle’s');
    } else {
      tally.accepted += 1;
    }
    return;
  }
  try {
    await setUserTimeZone(db, userId, timeZone);
    tally.accepted += 1;
  } catch {
    // validTimeZone refuses before writing anything, so the transaction is
    // still good: a zone this server's Postgres doesn't know is only skipped.
    tally.skip('Time zone this server does not know');
  }
}

/** Restores a merge rule on createMergeRule's terms; the reason when it can't. */
async function restoreMergeRule(
  db: Db,
  userId: string,
  rule: RecordOf<'mergeRule'>,
): Promise<string | null> {
  const from: Entry = { app: rule.fromApp.trim(), context: rule.fromContext?.trim() || null };
  const to: Entry = { app: rule.toApp.trim(), context: rule.toContext?.trim() || null };
  if ((from.context === null && to.context !== null) || sameEntry(from, to)) {
    return 'Merge rule that merges nothing';
  }
  const existing = await loadMergeRules(db, userId);
  if (existing.some((r) => sameEntry({ app: r.fromApp, context: r.fromContext }, from))) {
    return 'Merge rule for an entry you already merge';
  }
  if (sameEntry(mergeEntry(existing, to), from)) return 'Merge rule that would form a loop';
  // No sweep: the pings this restore folds already go through the rule, and
  // the summaries it restores were merged where they came from.
  await db.insert(mergeRules).values({
    id: crypto.randomUUID(),
    userId,
    fromApp: from.app,
    fromContext: from.context,
    toApp: to.app,
    toContext: to.context,
  });
  return null;
}

/** The second pass. Returns whether the end record was reached. */
async function restoreHistory({ db, userId, state, tally }: Restore, records: readonly string[]) {
  // Each device's first restored ping, as a day in the caller's zone — where
  // the rebuilt history starts and restored summaries stop. Undefined: no
  // pings, so every summary is needed.
  const firstDays = new Map<string, string | undefined>();
  const firstDay = async (deviceId: string) => {
    if (!firstDays.has(deviceId)) {
      const [row] = await db
        .select({
          day: sql<
            string | null
          >`to_char(min(${pings.capturedAt}) at time zone ${ownerZone}, 'YYYY-MM-DD')`,
        })
        .from(pings)
        .innerJoin(devices, eq(pings.deviceId, devices.id))
        .innerJoin(user, eq(devices.userId, user.id))
        .where(eq(pings.deviceId, deviceId))
        .groupBy(user.timeZone);
      firstDays.set(deviceId, row?.day ?? undefined);
    }
    return firstDays.get(deviceId);
  };
  const before = async (deviceId: string, day: string) => {
    const first = await firstDay(deviceId);
    return first === undefined || day < first;
  };
  const dayOfInstant = async (at: number) => {
    const [row] = await db
      .select({
        day: sql<string>`to_char(${new Date(at).toISOString()}::timestamptz at time zone ${ownerZone}, 'YYYY-MM-DD')`,
      })
      .from(user)
      .where(eq(user.id, userId));
    return row!.day;
  };

  for (const record of records) {
    const parsed = parseRecord(record);
    if (typeof parsed === 'string') {
      tally.skip(parsed);
      continue;
    }
    const { type, value } = parsed;
    if (type === 'end') return true;

    if (type === 'summary') {
      const summary = read('summary', value);
      const deviceId = summary && state.devices[summary.deviceId];
      if (!summary) tally.skip('Malformed summary');
      else if (!deviceId) tally.skip('Summary for a device that was not restored');
      else if (await before(deviceId, summary.day)) {
        await addSeconds(
          db,
          {
            deviceId,
            day: summary.day,
            app: summary.app,
            context: summary.context,
            categoryId: summary.categoryId ? (state.categories[summary.categoryId] ?? null) : null,
          },
          summary.seconds,
        );
        tally.accepted += 1;
      }
      continue;
    }

    if (type === 'activity') {
      const activity = read('activity', value);
      const deviceId = activity && state.devices[activity.deviceId];
      if (!activity) {
        tally.skip('Malformed activity');
        continue;
      }
      if (!deviceId) {
        tally.skip('Activity for a device that was not restored');
        continue;
      }
      const categoryId = activity.categoryId
        ? (state.categories[activity.categoryId] ?? null)
        : null;
      if (!activity.rolledUp) {
        // Not yet in any summary. From before the pings, nothing else will
        // bring it back, so it becomes one.
        const day = await dayOfInstant(activity.startedAt);
        if (await before(deviceId, day)) {
          await addSeconds(
            db,
            { deviceId, day, app: activity.app, context: activity.context, categoryId },
            activity.activeSeconds,
          );
          tally.accepted += 1;
          continue;
        }
      }
      if (activity.categorySource === 'manual' && categoryId) {
        const [rebuilt] = await db
          .select()
          .from(activities)
          .where(
            and(
              eq(activities.deviceId, deviceId),
              eq(activities.app, activity.app),
              activity.context === null
                ? sql`${activities.context} is null`
                : eq(activities.context, activity.context),
              eq(activities.startedAt, new Date(activity.startedAt)),
            ),
          )
          .limit(1);
        if (rebuilt) {
          await db
            .update(activities)
            .set({ categoryId, categorySource: 'manual' })
            .where(eq(activities.id, rebuilt.id));
          await moveRolledSeconds(db, rebuilt, rebuilt.categoryId, categoryId);
          tally.accepted += 1;
        } else {
          tally.skip('Manual category for an activity the pings did not rebuild');
        }
      }
    }
    // Everything else was restored on the first pass.
  }
  return false;
}
