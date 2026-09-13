import type { QueryResolvers } from '@eunomia/gql/resolvers';
import { and, eq, type SQL, sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { dayOf, ownerJoin, ownerZone } from '../activity/rollup.ts';
import type { Db } from '../db/client.ts';
import { activities, categories, devices, summaries, user } from '../db/schema.ts';
import { badInput } from '../errors.ts';
import { requireUser } from './guards.ts';

// The dashboard's two aggregates. Both answer the same question in different
// groupings, and both have to stitch together the same two halves: the
// precomputed `summaries` rows and a live aggregation over whatever the
// 15-minute rollup hasn't claimed yet.

/**
 * Narrows an aggregate to one device, or to nothing at all when omitted.
 *
 * No ownership check needed: every query here already joins devices on
 * `userId`, so another user's id simply matches no rows rather than leaking
 * theirs.
 */
const deviceFilter = (column: AnyPgColumn, deviceId: string | null | undefined) =>
  deviceId ? [eq(column, deviceId)] : [];

/** A calendar date as the dashboard sends it. */
const CALENDAR_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Whether `value` is a real 'YYYY-MM-DD' date. Round-tripped because Date is
 * lenient: it reads 02-31 as March 3rd, where Postgres would refuse the cast
 * and fail the request instead.
 */
export function isCalendarDay(value: string): boolean {
  if (!CALENDAR_DAY.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/**
 * Whole-day window [from, to) as calendar dates in the CALLER's time zone
 * (their own, or the server's when they never set one — rollup.ts ownerZone),
 * which is the zone rollup buckets their summaries.day into. A bare
 * 'YYYY-MM-DD' is that calendar day where they are; a full timestamp is
 * whichever day that instant falls on there.
 *
 * Kept in SQL, not JS, and that is the whole point: a JS Date is an instant,
 * so filtering startedAt by instants cut the live half of a summary at UTC
 * midnight while the rolled half had been cut at local midnight. The two
 * halves then disagreed, and today's evening read as empty until the next
 * 15-minute rollup moved it across. Both halves read ownerZone, so every
 * query using these bounds joins the owner (ownerJoin).
 *
 * Exported with the two bounds below for assignEntry, which has to claim
 * exactly the seconds these aggregates showed the review queue — the same
 * window, cut the same way.
 */
export function parseRange(args: { from: string; to: string }): { from: SQL; to: SQL } {
  const bound = (value: string): SQL => {
    if (CALENDAR_DAY.test(value)) {
      if (!isCalendarDay(value)) throw badInput('Invalid date range');
      return sql`${value}::date`;
    }
    if (Number.isNaN(new Date(value).getTime())) throw badInput('Invalid date range');
    return sql`(${value}::timestamptz at time zone ${ownerZone})::date`;
  };
  return { from: bound(args.from), to: bound(args.to) };
}

/** The window over raw activity rows — the not-yet-rolled-up half. */
export const liveDayBounds = (from: SQL, to: SQL) => [
  // A local date at midnight, placed in the owner's zone: the instant their
  // day starts.
  sql`${activities.startedAt} >= ${from}::timestamp at time zone ${ownerZone}`,
  sql`${activities.startedAt} < ${to}::timestamp at time zone ${ownerZone}`,
];

/** The same window over rolled rows, which only remember their day string. */
export const summaryDayBounds = (from: SQL, to: SQL) => [
  sql`${summaries.day} >= to_char(${from}, 'YYYY-MM-DD')`,
  sql`${summaries.day} < to_char(${to}, 'YYYY-MM-DD')`,
];

/** Merges rolled and live aggregate rows sharing a key, summing seconds. */
export function mergeSummaries<T extends { seconds: number }>(
  rows: T[],
  keyOf: (row: T) => string,
): T[] {
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
    // Seconds of active time per category per day, for the whole days
    // [from, to) in the caller's time zone.
    // Each activity's whole activeSeconds lands on the day it started —
    // activities are short-lived (auto-closed after 15 min unfocused), so
    // midnight-spanning error is negligible for a dashboard.
    categorySummary: async (_source, args, ctx) => {
      const userId = requireUser(ctx);
      const { from, to } = parseRange(args);
      const rows = await rolledPlusLive(
        db
          .select({
            day: summaries.day,
            categoryId: summaries.categoryId,
            name: categories.name,
            color: categories.color,
            kind: categories.kind,
            seconds: sql<number>`sum(${summaries.seconds})::float`,
          })
          .from(summaries)
          .innerJoin(devices, eq(summaries.deviceId, devices.id))
          .innerJoin(user, ownerJoin.user)
          .leftJoin(categories, eq(summaries.categoryId, categories.id))
          .where(
            and(
              eq(devices.userId, userId),
              ...deviceFilter(summaries.deviceId, args.deviceId),
              ...summaryDayBounds(from, to),
            ),
          )
          .groupBy(
            summaries.day,
            summaries.categoryId,
            categories.name,
            categories.color,
            categories.kind,
          ),
        db
          .select({
            day: dayOf,
            categoryId: activities.categoryId,
            name: categories.name,
            color: categories.color,
            kind: categories.kind,
            seconds: sql<number>`sum(${activities.activeSeconds})::float`,
          })
          .from(activities)
          .innerJoin(devices, ownerJoin.device)
          .innerJoin(user, ownerJoin.user)
          .leftJoin(categories, eq(activities.categoryId, categories.id))
          .where(
            and(
              eq(devices.userId, userId),
              ...deviceFilter(activities.deviceId, args.deviceId),
              eq(activities.rolledUp, false),
              ...liveDayBounds(from, to),
            ),
          )
          .groupBy(
            dayOf,
            activities.categoryId,
            categories.name,
            categories.color,
            categories.kind,
          ),
        (row) => `${row.day}\n${row.categoryId ?? ''}`,
      );
      return rows.sort(
        (a, b) =>
          a.day.localeCompare(b.day) ||
          // Uncategorized last within a day, like SQL's default nulls-last.
          (a.categoryId ?? '￿').localeCompare(b.categoryId ?? '￿'),
      );
    },
    // Seconds of active time per (app, context, category) for [from, to),
    // largest first — the dashboard's top-apps list without shipping raw
    // activities.
    //
    // Category is part of the key, not a label hung off the app: an app's time
    // can land in several categories (a browser is Work on one site and not on
    // the next), so one row per pair would have to pick a winner here. Split
    // rows let the caller color a bar by what its seconds actually were.
    appSummary: async (_source, args, ctx) => {
      const userId = requireUser(ctx);
      const { from, to } = parseRange(args);
      const rows = await rolledPlusLive(
        db
          .select({
            app: summaries.app,
            context: summaries.context,
            categoryId: summaries.categoryId,
            categoryName: categories.name,
            categoryColor: categories.color,
            seconds: sql<number>`sum(${summaries.seconds})::float`,
          })
          .from(summaries)
          .innerJoin(devices, eq(summaries.deviceId, devices.id))
          .innerJoin(user, ownerJoin.user)
          .leftJoin(categories, eq(summaries.categoryId, categories.id))
          .where(
            and(
              eq(devices.userId, userId),
              ...deviceFilter(summaries.deviceId, args.deviceId),
              ...summaryDayBounds(from, to),
            ),
          )
          .groupBy(
            summaries.app,
            summaries.context,
            summaries.categoryId,
            categories.name,
            categories.color,
          ),
        db
          .select({
            app: activities.app,
            context: activities.context,
            categoryId: activities.categoryId,
            categoryName: categories.name,
            categoryColor: categories.color,
            seconds: sql<number>`sum(${activities.activeSeconds})::float`,
          })
          .from(activities)
          .innerJoin(devices, ownerJoin.device)
          .innerJoin(user, ownerJoin.user)
          .leftJoin(categories, eq(activities.categoryId, categories.id))
          .where(
            and(
              eq(devices.userId, userId),
              ...deviceFilter(activities.deviceId, args.deviceId),
              eq(activities.rolledUp, false),
              ...liveDayBounds(from, to),
            ),
          )
          .groupBy(
            activities.app,
            activities.context,
            activities.categoryId,
            categories.name,
            categories.color,
          ),
        (row) => `${row.app}\n${row.context ?? ''}\n${row.categoryId ?? ''}`,
      );
      return rows.sort((a, b) => b.seconds - a.seconds);
    },
    // Seconds of active time per device for [from, to), busiest first. No
    // deviceId arg: this is the aggregate the device filter is chosen from, so
    // narrowing it to one device would defeat its purpose.
    deviceSummary: async (_source, args, ctx) => {
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
          .innerJoin(user, ownerJoin.user)
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
          .innerJoin(devices, ownerJoin.device)
          .innerJoin(user, ownerJoin.user)
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
  } satisfies QueryResolvers;
}
