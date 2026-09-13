import { and, asc, eq, gt, sql } from 'drizzle-orm';
import { z } from 'zod';
import { ownerZone } from '../activity/rollup.ts';
import type { Db } from '../db/client.ts';
import {
  activities,
  categories,
  categoryRules,
  contextRules,
  devices,
  focusSegments,
  mergeRules,
  pings,
  summaries,
  user,
} from '../db/schema.ts';
import { badInput } from '../errors.ts';
import { VERSION } from '../health.ts';
import type { ExportWriter } from './chunk.ts';

// The account bundle: everything the server keeps about one user that is
// theirs rather than the server's, as JSON Lines. One record per line, each
// tagged with `type`:
//
//   {"format":"eunomia-export","version":1,"exportedAt":…,"server":…}
//   {"type":"profile",…}            the user, and the zone their days split in
//   {"type":"device",…}             no key material — keys belong to the server
//   {"type":"category",…}  {"type":"categoryRule",…}
//   {"type":"contextRule",…}  {"type":"mergeRule",…}
//   {"type":"summary",…}  {"type":"activity",…}  {"type":"focusSegment",…}
//   {"type":"ping",…}               the raw log, in fold order per device
//   {"type":"end","counts":{…}}     absent = the file was cut short
//
// Lines rather than one JSON document because the file is written a chunk at a
// time and will be read the same way: chunks concatenate without bracket
// bookkeeping, and an importer can stream it line by line instead of parsing
// tens of megabytes of pings at once. Records come in dependency order —
// devices and categories before the rows that reference them.
//
// Never in it: API keys (hashes or otherwise), sessions, accounts (password
// hashes, OAuth tokens) and verification tokens. Nothing here reads those
// tables at all, which is simpler to trust than a column filter over them.
// Columns are listed per record rather than `select()`-ed whole, so a column
// added to a table later isn't exported until someone decides it should be —
// and the format version moves when it is.

export const BUNDLE_FORMAT = 'eunomia-export';
export const BUNDLE_VERSION = 1;

/** Where one section's keyset left off: its sort key's values, as text. */
type After = string[] | null;

interface Page {
  records: Record<string, unknown>[];
  /** The last row's sort key, to resume after. */
  last: After;
}

interface Section {
  type: string;
  /** How many values its sort key has — what a resumed `after` must carry. */
  keyLength: number;
  read(db: Db, userId: string, after: After, limit: number): Promise<Page>;
}

/**
 * A table the user owns directly, a page at a time by id. Ids are random, so
 * this is no meaningful order — only a stable one.
 */
function ownedById<T extends { id: string }>(
  type: string,
  query: (db: Db, userId: string, after: string | null, limit: number) => Promise<T[]>,
): Section {
  return {
    type,
    keyLength: 1,
    async read(db, userId, after, limit) {
      const rows = await query(db, userId, after?.[0] ?? null, limit);
      return { records: rows, last: rows.length > 0 ? [rows.at(-1)!.id] : null };
    },
  };
}

/**
 * A device-scoped table's rows as records, with the sort key they were read
 * under split back off. Timestamps in a key travel as Postgres's own text:
 * a JS Date keeps milliseconds, and a key that lost the microseconds of a
 * `now()`-stamped row would resume before that row and read it again forever.
 */
function split<T extends { key: string[] }>(rows: T[]): Page {
  return {
    records: rows.map(({ key: _key, ...record }) => record),
    last: rows.at(-1)?.key ?? null,
  };
}

const SECTIONS: Section[] = [
  // pingLogFrom and replayFrom come along: they say which part of the ping log
  // below is complete, which an importer needs in order to tell what it can
  // rebuild from pings from what only the summaries still hold.
  ownedById('device', (db, userId, after, limit) =>
    db
      .select({
        id: devices.id,
        name: devices.name,
        platform: devices.platform,
        createdAt: devices.createdAt,
        lastSeenAt: devices.lastSeenAt,
        pingLogFrom: devices.pingLogFrom,
        replayFrom: devices.replayFrom,
      })
      .from(devices)
      .where(and(eq(devices.userId, userId), after ? gt(devices.id, after) : undefined))
      .orderBy(asc(devices.id))
      .limit(limit),
  ),
  ownedById('category', (db, userId, after, limit) =>
    db
      .select({
        id: categories.id,
        name: categories.name,
        color: categories.color,
        kind: categories.kind,
        createdAt: categories.createdAt,
      })
      .from(categories)
      .where(and(eq(categories.userId, userId), after ? gt(categories.id, after) : undefined))
      .orderBy(asc(categories.id))
      .limit(limit),
  ),
  ownedById('categoryRule', (db, userId, after, limit) =>
    db
      .select({
        id: categoryRules.id,
        categoryId: categoryRules.categoryId,
        appPattern: categoryRules.appPattern,
        titlePattern: categoryRules.titlePattern,
        contextPattern: categoryRules.contextPattern,
        priority: categoryRules.priority,
        createdAt: categoryRules.createdAt,
      })
      .from(categoryRules)
      .where(and(eq(categoryRules.userId, userId), after ? gt(categoryRules.id, after) : undefined))
      .orderBy(asc(categoryRules.id))
      .limit(limit),
  ),
  ownedById('contextRule', (db, userId, after, limit) =>
    db
      .select({
        id: contextRules.id,
        appPattern: contextRules.appPattern,
        titlePattern: contextRules.titlePattern,
        priority: contextRules.priority,
        createdAt: contextRules.createdAt,
      })
      .from(contextRules)
      .where(and(eq(contextRules.userId, userId), after ? gt(contextRules.id, after) : undefined))
      .orderBy(asc(contextRules.id))
      .limit(limit),
  ),
  ownedById('mergeRule', (db, userId, after, limit) =>
    db
      .select({
        id: mergeRules.id,
        fromApp: mergeRules.fromApp,
        fromContext: mergeRules.fromContext,
        toApp: mergeRules.toApp,
        toContext: mergeRules.toContext,
        createdAt: mergeRules.createdAt,
      })
      .from(mergeRules)
      .where(and(eq(mergeRules.userId, userId), after ? gt(mergeRules.id, after) : undefined))
      .orderBy(asc(mergeRules.id))
      .limit(limit),
  ),
  {
    type: 'summary',
    keyLength: 3,
    async read(db, userId, after, limit) {
      const rows = await db
        .select({
          id: summaries.id,
          deviceId: summaries.deviceId,
          day: summaries.day,
          app: summaries.app,
          context: summaries.context,
          categoryId: summaries.categoryId,
          seconds: summaries.seconds,
          key: sql<string[]>`array[${summaries.deviceId}, ${summaries.day}, ${summaries.id}]`,
        })
        .from(summaries)
        .innerJoin(devices, eq(summaries.deviceId, devices.id))
        .where(
          and(
            eq(devices.userId, userId),
            after
              ? sql`(${summaries.deviceId}, ${summaries.day}, ${summaries.id}) > (${after[0]}, ${after[1]}, ${after[2]})`
              : undefined,
          ),
        )
        .orderBy(asc(summaries.deviceId), asc(summaries.day), asc(summaries.id))
        .limit(limit);
      return split(rows);
    },
  },
  {
    type: 'activity',
    keyLength: 3,
    async read(db, userId, after, limit) {
      const rows = await db
        .select({
          id: activities.id,
          deviceId: activities.deviceId,
          app: activities.app,
          context: activities.context,
          title: activities.title,
          startedAt: activities.startedAt,
          lastActiveAt: activities.lastActiveAt,
          activeSeconds: activities.activeSeconds,
          closedAt: activities.closedAt,
          categoryId: activities.categoryId,
          categorySource: activities.categorySource,
          rolledUp: activities.rolledUp,
          key: sql<
            string[]
          >`array[${activities.deviceId}, ${activities.startedAt}::text, ${activities.id}]`,
        })
        .from(activities)
        .innerJoin(devices, eq(activities.deviceId, devices.id))
        .where(
          and(
            eq(devices.userId, userId),
            after
              ? sql`(${activities.deviceId}, ${activities.startedAt}, ${activities.id}) > (${after[0]}, ${after[1]}::timestamptz, ${after[2]})`
              : undefined,
          ),
        )
        .orderBy(asc(activities.deviceId), asc(activities.startedAt), asc(activities.id))
        .limit(limit);
      return split(rows);
    },
  },
  {
    type: 'focusSegment',
    keyLength: 3,
    async read(db, userId, after, limit) {
      const rows = await db
        .select({
          id: focusSegments.id,
          deviceId: focusSegments.deviceId,
          activityId: focusSegments.activityId,
          startedAt: focusSegments.startedAt,
          endedAt: focusSegments.endedAt,
          key: sql<
            string[]
          >`array[${focusSegments.deviceId}, ${focusSegments.startedAt}::text, ${focusSegments.id}]`,
        })
        .from(focusSegments)
        .innerJoin(devices, eq(focusSegments.deviceId, devices.id))
        .where(
          and(
            eq(devices.userId, userId),
            after
              ? sql`(${focusSegments.deviceId}, ${focusSegments.startedAt}, ${focusSegments.id}) > (${after[0]}, ${after[1]}::timestamptz, ${after[2]})`
              : undefined,
          ),
        )
        .orderBy(asc(focusSegments.deviceId), asc(focusSegments.startedAt), asc(focusSegments.id))
        .limit(limit);
      return split(rows);
    },
  },
  {
    // In fold order within each device — capturedAt, then arrival — which is
    // the order an importer has to feed them back in. `seq` itself is left
    // out: it is this database's identity column, meaningless in another.
    type: 'ping',
    keyLength: 3,
    async read(db, userId, after, limit) {
      const rows = await db
        .select({
          deviceId: pings.deviceId,
          capturedAt: pings.capturedAt,
          app: pings.app,
          title: pings.title,
          context: pings.context,
          idleSeconds: pings.idleSeconds,
          key: sql<
            string[]
          >`array[${pings.deviceId}, ${pings.capturedAt}::text, ${pings.seq}::text]`,
        })
        .from(pings)
        .innerJoin(devices, eq(pings.deviceId, devices.id))
        .where(
          and(
            eq(devices.userId, userId),
            after
              ? sql`(${pings.deviceId}, ${pings.capturedAt}, ${pings.seq}) > (${after[0]}, ${after[1]}::timestamptz, ${after[2]}::bigint)`
              : undefined,
          ),
        )
        .orderBy(asc(pings.deviceId), asc(pings.capturedAt), asc(pings.seq))
        .limit(limit);
      return split(rows);
    },
  },
];

const bundleState = z.object({
  /** Index into SECTIONS; SECTIONS.length once every section is written. */
  section: z.number().int().min(0).max(SECTIONS.length),
  after: z.array(z.string()).min(1).max(3).nullable(),
  /** Records written so far per type, for the closing record. */
  counts: z.record(z.string(), z.number().int().min(0)),
});

type BundleState = z.infer<typeof bundleState>;

const line = (record: unknown): string => `${JSON.stringify(record)}\n`;

export const bundleChunk: ExportWriter<BundleState> = {
  state: bundleState,
  ranged: false,
  async write(db, { userId, state: resumed, pageSize }) {
    let out = '';
    let rows = 0;
    const state: BundleState = resumed ?? { section: 0, after: null, counts: {} };

    if (!resumed) {
      out += line({
        format: BUNDLE_FORMAT,
        version: BUNDLE_VERSION,
        exportedAt: new Date().toISOString(),
        server: VERSION,
      });
      // The zone rather than just `timeZone`: every summary.day below was
      // bucketed in the effective one, which a reader can't know otherwise
      // when the user followed the server's.
      const [profile] = await db
        .select({
          id: user.id,
          name: user.name,
          email: user.email,
          createdAt: user.createdAt,
          timeZone: user.timeZone,
          effectiveTimeZone: ownerZone,
        })
        .from(user)
        .where(eq(user.id, userId));
      out += line({ type: 'profile', ...profile });
      state.counts.profile = 1;
      rows += 1;
    }

    while (state.section < SECTIONS.length && rows < pageSize) {
      const section = SECTIONS[state.section]!;
      if (state.after && state.after.length !== section.keyLength) {
        throw badInput('Invalid export cursor');
      }
      const limit = pageSize - rows;
      const page = await section.read(db, userId, state.after, limit);
      for (const record of page.records) out += line({ type: section.type, ...record });
      rows += page.records.length;
      state.counts[section.type] = (state.counts[section.type] ?? 0) + page.records.length;
      if (page.records.length < limit) {
        // A short page is the section's last: move on without asking again.
        state.section += 1;
        state.after = null;
      } else {
        state.after = page.last;
      }
    }

    if (state.section < SECTIONS.length) return { data: out, rows, state };
    out += line({ type: 'end', counts: state.counts });
    return { data: out, rows, state: null };
  },
};
