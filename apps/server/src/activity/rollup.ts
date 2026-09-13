import { and, eq, gte, inArray, isNotNull, lt, sql } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { activities, summaries } from '../db/schema.ts';
import type { Activity } from './fold.ts';
import { prunePings } from './ping-log.ts';

// Rollups fold closed activities into the summaries table so dashboards
// aggregate a few precomputed rows instead of every raw activity. Closed
// activities never accrue again (fold only touches open rows), so their
// seconds are stable — the only thing that can change afterwards is the
// category, and those paths move the seconds explicitly (moveRolledSeconds).

/** The summary day of an activity's startedAt — same expression the live summary queries group by. */
const dayOf = sql<string>`to_char(date_trunc('day', ${activities.startedAt}), 'YYYY-MM-DD')`;

/** Ids per "mark rolled" UPDATE — well under Postgres's 65535 bind parameters. */
const MARK_CHUNK = 10_000;

interface SummaryKey {
  deviceId: string;
  day: string;
  app: string;
  context: string | null;
  categoryId: string | null;
}

/** Upserts `seconds` (possibly negative) into the summary row for `key`. */
export async function addSeconds(db: Db, key: SummaryKey, seconds: number): Promise<void> {
  await db
    .insert(summaries)
    .values({ id: crypto.randomUUID(), ...key, seconds })
    .onConflictDoUpdate({
      target: [
        summaries.deviceId,
        summaries.day,
        summaries.app,
        summaries.context,
        summaries.categoryId,
      ],
      set: { seconds: sql`${summaries.seconds} + excluded.seconds` },
    });
}

/**
 * Folds every closed, not-yet-rolled activity into the summaries table and
 * marks it rolled. Idempotent: only the exact rows summed get marked, inside
 * one transaction. Returns how many activities were rolled.
 *
 * `deviceId` narrows it to one device — how replay rolls what it rebuilt
 * without waiting for the timer.
 */
export async function rollupActivities(db: Db, deviceId?: string): Promise<number> {
  return db.transaction(async (tx) => {
    const rows = await tx
      .select({
        id: activities.id,
        deviceId: activities.deviceId,
        day: dayOf,
        app: activities.app,
        context: activities.context,
        categoryId: activities.categoryId,
        activeSeconds: activities.activeSeconds,
      })
      .from(activities)
      .where(
        and(
          isNotNull(activities.closedAt),
          eq(activities.rolledUp, false),
          deviceId ? eq(activities.deviceId, deviceId) : undefined,
        ),
      );
    if (rows.length === 0) return 0;

    const groups = new Map<string, { key: SummaryKey; seconds: number }>();
    for (const row of rows) {
      const key = `${row.deviceId}\n${row.day}\n${row.app}\n${row.context ?? '\0'}\n${row.categoryId ?? '\0'}`;
      const group = groups.get(key) ?? {
        key: {
          deviceId: row.deviceId,
          day: row.day,
          app: row.app,
          context: row.context,
          categoryId: row.categoryId,
        },
        seconds: 0,
      };
      group.seconds += row.activeSeconds;
      groups.set(key, group);
    }
    for (const { key, seconds } of groups.values()) {
      await addSeconds(tx, key, seconds);
    }
    // Chunked: a replay over months of history can roll more rows at once
    // than one statement has bind parameters for.
    for (let i = 0; i < rows.length; i += MARK_CHUNK) {
      await tx
        .update(activities)
        .set({ rolledUp: true })
        .where(
          inArray(
            activities.id,
            rows.slice(i, i + MARK_CHUNK).map((row) => row.id),
          ),
        );
    }
    return rows.length;
  });
}

/**
 * Takes the seconds of a device's rolled activities that started at or after
 * `from` back out of their summary rows — the inverse of rollupActivities, for
 * replay, which is about to delete those activities and fold them again.
 *
 * Subtracts rather than deleting the affected days' rows: a day can hold
 * seconds from activities that started before `from`, or that were pruned
 * long ago, and nothing but the summary row remembers those.
 */
export async function unrollActivities(db: Db, deviceId: string, from: Date): Promise<void> {
  const rows = await db
    .select({
      day: dayOf,
      app: activities.app,
      context: activities.context,
      categoryId: activities.categoryId,
      seconds: sql<number>`sum(${activities.activeSeconds})::float`,
    })
    .from(activities)
    .where(
      and(
        eq(activities.deviceId, deviceId),
        eq(activities.rolledUp, true),
        gte(activities.startedAt, from),
      ),
    )
    .groupBy(dayOf, activities.app, activities.context, activities.categoryId);
  for (const { seconds, ...key } of rows) {
    await addSeconds(db, { deviceId, ...key }, -seconds);
  }
}

/**
 * Deletes a device's summary rows left holding nothing — what taking seconds
 * out and folding them back in leaves behind wherever the rebuild put the
 * time somewhere else. The tolerance absorbs float residue: subtracting a
 * sum and re-adding its parts in a different order isn't exactly zero.
 */
export async function dropEmptySummaries(db: Db, deviceId: string): Promise<void> {
  await db
    .delete(summaries)
    .where(and(eq(summaries.deviceId, deviceId), sql`abs(${summaries.seconds}) < 1e-6`));
}

/**
 * Moves an already-rolled activity's seconds to a different category's summary
 * row — call after changing the category of an activity with rolledUp set
 * (assignActivity, rule sweeps). No-op for un-rolled rows: their seconds
 * haven't been summarized yet.
 */
export async function moveRolledSeconds(
  db: Db,
  activity: Activity,
  fromCategoryId: string | null,
  toCategoryId: string | null,
): Promise<void> {
  if (!activity.rolledUp || fromCategoryId === toCategoryId) return;
  const [row] = await db
    .select({ day: dayOf })
    .from(activities)
    .where(eq(activities.id, activity.id))
    .limit(1);
  if (!row) return;
  const key = {
    deviceId: activity.deviceId,
    day: row.day,
    app: activity.app,
    context: activity.context,
  };
  await addSeconds(db, { ...key, categoryId: fromCategoryId }, -activity.activeSeconds);
  await addSeconds(db, { ...key, categoryId: toCategoryId }, activity.activeSeconds);
}

/**
 * Folds a category's summary rows into the matching uncategorized rows — run
 * before deleting the category, mirroring what its FK set-null does to raw
 * activities (a plain set-null on summaries would collide with the unique
 * key's existing uncategorized rows).
 */
export async function mergeCategorySummaries(db: Db, categoryId: string): Promise<void> {
  const rows = await db.select().from(summaries).where(eq(summaries.categoryId, categoryId));
  for (const row of rows) {
    await addSeconds(
      db,
      {
        deviceId: row.deviceId,
        day: row.day,
        app: row.app,
        context: row.context,
        categoryId: null,
      },
      row.seconds,
    );
    await db.delete(summaries).where(eq(summaries.id, row.id));
  }
}

/**
 * Deletes raw activities older than `retentionDays` that have already been
 * folded into summaries — the aggregates (and so every dashboard view) are
 * unaffected, but pruned time can no longer be re-categorized individually.
 * Un-rolled and open rows are never touched at any age: their seconds only
 * exist on the activity row. A non-positive `retentionDays` keeps everything.
 * Returns how many rows were deleted.
 */
export async function pruneActivities(db: Db, retentionDays: number): Promise<number> {
  if (!(retentionDays > 0)) return 0;
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
  const deleted = await db
    .delete(activities)
    .where(
      and(
        eq(activities.rolledUp, true),
        isNotNull(activities.closedAt),
        lt(activities.startedAt, cutoff),
      ),
    )
    .returning({ id: activities.id });
  return deleted.length;
}

/** Days of raw activities kept when ACTIVITY_RETENTION_DAYS says nothing. */
export const DEFAULT_RETENTION_DAYS = 90;

/**
 * Days of raw activities — and of the raw pings they were folded from — to
 * keep. Summaries are never pruned, so history charts survive; only
 * per-activity detail (titles, re-categorization, replay) ages out. Set
 * ACTIVITY_RETENTION_DAYS=0 to keep raw rows forever.
 *
 * Throws on anything else. This setting decides what gets deleted, and every
 * way of quietly guessing at a bad value is wrong in a way the operator only
 * finds out about months later: `ACTIVITY_RETENTION_DAYS=` (an empty value in
 * a compose file, easily written by accident) parses as 0 and keeps everything
 * forever, while `ACTIVITY_RETENTION_DAYS=ninety` parses as nothing and
 * silently deletes on the default schedule.
 */
export function retentionDays(): number {
  const configured = process.env.ACTIVITY_RETENTION_DAYS?.trim();
  if (!configured) return DEFAULT_RETENTION_DAYS;
  const days = Number(configured);
  if (!Number.isInteger(days) || days < 0) {
    throw new Error(
      `ACTIVITY_RETENTION_DAYS must be a whole number of days, 0 or more ` +
        `(got ${JSON.stringify(configured)}); 0 keeps raw activities forever`,
    );
  }
  return days;
}

/** How often the background rollup runs; also runs once at server start. */
export const ROLLUP_INTERVAL_MS = 15 * 60 * 1000;

export function startRollupTimer(db: Db): void {
  // Read at boot, not per run: a misconfigured retention should stop the
  // server, not disappear into the catch below every fifteen minutes.
  const retention = retentionDays();
  const run = async (): Promise<void> => {
    try {
      const rolled = await rollupActivities(db);
      if (rolled > 0) console.log(`rolled up ${rolled} activities`);
      // Prune only after rolling, so nothing is deleted before its seconds
      // are safely in a summary row.
      const pruned = await pruneActivities(db, retention);
      if (pruned > 0) console.log(`pruned ${pruned} raw activities past retention`);
      const prunedPings = await prunePings(db, retention);
      if (prunedPings > 0) console.log(`pruned ${prunedPings} raw pings past retention`);
    } catch (error) {
      console.error('rollup failed', error);
    }
  };
  void run();
  setInterval(() => void run(), ROLLUP_INTERVAL_MS);
}
