import { and, eq, type SQL, sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import {
  GraphQLFloat,
  GraphQLList,
  GraphQLNonNull,
  GraphQLObjectType,
  GraphQLString,
} from 'graphql';
import type { Db } from '../db/client.ts';
import { activities, categories, devices, summaries } from '../db/schema.ts';
import { badInput } from '../errors.ts';
import type { Context } from './context.ts';
import type { Fields } from './entities.ts';
import { requireUser } from './guards.ts';

// The dashboard's two aggregates. Both answer the same question in different
// groupings, and both have to stitch together the same two halves: the
// precomputed `summaries` rows and a live aggregation over whatever the
// 15-minute rollup hasn't claimed yet.

/** Dashboard aggregate row: active seconds per category per day (server zone). */
const categoryDaySummaryType = new GraphQLObjectType({
  name: 'CategoryDaySummary',
  fields: {
    day: { type: new GraphQLNonNull(GraphQLString) },
    // Null category = uncategorized time.
    categoryId: { type: GraphQLString },
    name: { type: GraphQLString },
    color: { type: GraphQLString },
    seconds: { type: new GraphQLNonNull(GraphQLFloat) },
  },
});

/**
 * Dashboard aggregate row: active seconds per app (and per context within it)
 * over a range.
 */
const appContextSummaryType = new GraphQLObjectType({
  name: 'AppContextSummary',
  fields: {
    app: { type: new GraphQLNonNull(GraphQLString) },
    // Null = the app's time with no finer division.
    context: { type: GraphQLString },
    seconds: { type: new GraphQLNonNull(GraphQLFloat) },
  },
});

/**
 * Dashboard aggregate row: active seconds per device over a range — the
 * "split by device" view, and the picker's source for which devices actually
 * contributed time (a device with none is not worth offering to filter to).
 */
const deviceSummaryType = new GraphQLObjectType({
  name: 'DeviceSummary',
  fields: {
    deviceId: { type: new GraphQLNonNull(GraphQLString) },
    name: { type: new GraphQLNonNull(GraphQLString) },
    platform: { type: new GraphQLNonNull(GraphQLString) },
    seconds: { type: new GraphQLNonNull(GraphQLFloat) },
  },
});

interface RangeArgs {
  from: string;
  to: string;
  /** One device, or every device the user owns when absent. */
  deviceId?: string | null;
}

const rangeArgs = {
  from: { type: new GraphQLNonNull(GraphQLString) },
  to: { type: new GraphQLNonNull(GraphQLString) },
};

/** A range plus the optional device narrowing the two grouped aggregates take. */
const scopedRangeArgs = {
  ...rangeArgs,
  deviceId: { type: GraphQLString },
};

/**
 * Narrows an aggregate to one device, or to nothing at all when omitted.
 *
 * No ownership check needed: every query here already joins devices on
 * `userId`, so another user's id simply matches no rows rather than leaking
 * theirs.
 */
const deviceFilter = (column: AnyPgColumn, deviceId: string | null | undefined) =>
  deviceId ? [eq(column, deviceId)] : [];

/**
 * Whole-day window [from, to) resolved in the SERVER's time zone — the same
 * zone rollup buckets summaries.day into (db/client.ts sets the session zone
 * from TZ). Both ends truncate to local midnight, so a bare 'YYYY-MM-DD' from
 * the dashboard means that calendar day here, not in UTC.
 *
 * The truncation happens in SQL, not JS, and that is the whole point: a JS
 * Date is an instant, so filtering startedAt by instants cut the live half of
 * a summary at UTC midnight while the rolled half had been cut at local
 * midnight. On a non-UTC server the two halves then disagreed, and today's
 * evening read as empty until the next 15-minute rollup moved it across.
 */
function parseRange(args: RangeArgs): { from: SQL; to: SQL } {
  for (const value of [args.from, args.to]) {
    if (Number.isNaN(new Date(value).getTime())) throw badInput('Invalid date range');
  }
  return {
    from: sql`date_trunc('day', ${args.from}::timestamptz)`,
    to: sql`date_trunc('day', ${args.to}::timestamptz)`,
  };
}

/** The window over raw activity rows — the not-yet-rolled-up half. */
const liveDayBounds = (from: SQL, to: SQL) => [
  sql`${activities.startedAt} >= ${from}`,
  sql`${activities.startedAt} < ${to}`,
];

/** The same window over rolled rows, which only remember their day string. */
const summaryDayBounds = (from: SQL, to: SQL) => [
  sql`${summaries.day} >= to_char(${from}, 'YYYY-MM-DD')`,
  sql`${summaries.day} < to_char(${to}, 'YYYY-MM-DD')`,
];

/** Merges rolled and live aggregate rows sharing a key, summing seconds. */
function mergeSummaries<T extends { seconds: number }>(rows: T[], keyOf: (row: T) => string): T[] {
  const merged = new Map<string, T>();
  for (const row of rows) {
    const existing = merged.get(keyOf(row));
    if (existing) {
      existing.seconds += row.seconds;
    } else {
      merged.set(keyOf(row), { ...row });
    }
  }
  // Category moves can leave zeroed summary rows behind — not worth a bar.
  return [...merged.values()].filter((row) => row.seconds > 0);
}

/**
 * The shape both aggregates share: run the rolled and live halves — they touch
 * different tables, so concurrently — and fold them into one row per key.
 */
async function rolledPlusLive<T extends { seconds: number }>(
  rolled: Promise<T[]>,
  live: Promise<T[]>,
  keyOf: (row: T) => string,
): Promise<T[]> {
  const [rolledRows, liveRows] = await Promise.all([rolled, live]);
  return mergeSummaries([...rolledRows, ...liveRows], keyOf);
}

export function summaryFields(db: Db) {
  return {
    categorySummary: {
      // Seconds of active time per category per day, for the whole days
      // [from, to) in the server's time zone.
      // Each activity's whole activeSeconds lands on the day it started —
      // activities are short-lived (auto-closed after 15 min unfocused), so
      // midnight-spanning error is negligible for a dashboard.
      type: new GraphQLNonNull(new GraphQLList(new GraphQLNonNull(categoryDaySummaryType))),
      args: scopedRangeArgs,
      resolve: async (_source, args: RangeArgs, ctx: Context) => {
        const userId = requireUser(ctx);
        const { from, to } = parseRange(args);
        const day = sql<string>`to_char(date_trunc('day', ${activities.startedAt}), 'YYYY-MM-DD')`;
        const rows = await rolledPlusLive(
          db
            .select({
              day: summaries.day,
              categoryId: summaries.categoryId,
              name: categories.name,
              color: categories.color,
              seconds: sql<number>`sum(${summaries.seconds})::float`,
            })
            .from(summaries)
            .innerJoin(devices, eq(summaries.deviceId, devices.id))
            .leftJoin(categories, eq(summaries.categoryId, categories.id))
            .where(
              and(
                eq(devices.userId, userId),
                ...deviceFilter(summaries.deviceId, args.deviceId),
                ...summaryDayBounds(from, to),
              ),
            )
            .groupBy(summaries.day, summaries.categoryId, categories.name, categories.color),
          db
            .select({
              day,
              categoryId: activities.categoryId,
              name: categories.name,
              color: categories.color,
              seconds: sql<number>`sum(${activities.activeSeconds})::float`,
            })
            .from(activities)
            .innerJoin(devices, eq(activities.deviceId, devices.id))
            .leftJoin(categories, eq(activities.categoryId, categories.id))
            .where(
              and(
                eq(devices.userId, userId),
                ...deviceFilter(activities.deviceId, args.deviceId),
                eq(activities.rolledUp, false),
                ...liveDayBounds(from, to),
              ),
            )
            .groupBy(day, activities.categoryId, categories.name, categories.color),
          (row) => `${row.day}\n${row.categoryId ?? ''}`,
        );
        return rows.sort(
          (a, b) =>
            a.day.localeCompare(b.day) ||
            // Uncategorized last within a day, like SQL's default nulls-last.
            (a.categoryId ?? '￿').localeCompare(b.categoryId ?? '￿'),
        );
      },
    },
    appSummary: {
      // Seconds of active time per (app, context) for [from, to), largest
      // first — the dashboard's top-apps list without shipping raw activities.
      type: new GraphQLNonNull(new GraphQLList(new GraphQLNonNull(appContextSummaryType))),
      args: scopedRangeArgs,
      resolve: async (_source, args: RangeArgs, ctx: Context) => {
        const userId = requireUser(ctx);
        const { from, to } = parseRange(args);
        const rows = await rolledPlusLive(
          db
            .select({
              app: summaries.app,
              context: summaries.context,
              seconds: sql<number>`sum(${summaries.seconds})::float`,
            })
            .from(summaries)
            .innerJoin(devices, eq(summaries.deviceId, devices.id))
            .where(
              and(
                eq(devices.userId, userId),
                ...deviceFilter(summaries.deviceId, args.deviceId),
                ...summaryDayBounds(from, to),
              ),
            )
            .groupBy(summaries.app, summaries.context),
          db
            .select({
              app: activities.app,
              context: activities.context,
              seconds: sql<number>`sum(${activities.activeSeconds})::float`,
            })
            .from(activities)
            .innerJoin(devices, eq(activities.deviceId, devices.id))
            .where(
              and(
                eq(devices.userId, userId),
                ...deviceFilter(activities.deviceId, args.deviceId),
                eq(activities.rolledUp, false),
                ...liveDayBounds(from, to),
              ),
            )
            .groupBy(activities.app, activities.context),
          (row) => `${row.app}\n${row.context ?? ''}`,
        );
        return rows.sort((a, b) => b.seconds - a.seconds);
      },
    },
    deviceSummary: {
      // Seconds of active time per device for [from, to), busiest first. No
      // deviceId arg: this is the aggregate the device filter is chosen from,
      // so narrowing it to one device would defeat its purpose.
      type: new GraphQLNonNull(new GraphQLList(new GraphQLNonNull(deviceSummaryType))),
      args: rangeArgs,
      resolve: async (_source, args: RangeArgs, ctx: Context) => {
        const userId = requireUser(ctx);
        const { from, to } = parseRange(args);
        // name and platform come along for the ride: they're functionally
        // dependent on the id, so grouping by all three costs nothing and
        // saves the dashboard a second round-trip to label the picker.
        const rows = await rolledPlusLive(
          db
            .select({
              deviceId: summaries.deviceId,
              name: devices.name,
              platform: devices.platform,
              seconds: sql<number>`sum(${summaries.seconds})::float`,
            })
            .from(summaries)
            .innerJoin(devices, eq(summaries.deviceId, devices.id))
            .where(and(eq(devices.userId, userId), ...summaryDayBounds(from, to)))
            .groupBy(summaries.deviceId, devices.name, devices.platform),
          db
            .select({
              deviceId: activities.deviceId,
              name: devices.name,
              platform: devices.platform,
              seconds: sql<number>`sum(${activities.activeSeconds})::float`,
            })
            .from(activities)
            .innerJoin(devices, eq(activities.deviceId, devices.id))
            .where(
              and(
                eq(devices.userId, userId),
                eq(activities.rolledUp, false),
                ...liveDayBounds(from, to),
              ),
            )
            .groupBy(activities.deviceId, devices.name, devices.platform),
          (row) => row.deviceId,
        );
        return rows.sort((a, b) => b.seconds - a.seconds);
      },
    },
  } satisfies Fields;
}
