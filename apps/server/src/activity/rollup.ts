import { and, eq, inArray, isNotNull, lt, sql } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { activities, summaries } from '../db/schema.ts';
import type { Activity } from './fold.ts';

// Rollups fold closed activities into the summaries table so dashboards
// aggregate a few precomputed rows instead of every raw activity. Closed
// activities never accrue again (fold only touches open rows), so their
// seconds are stable — the only thing that can change afterwards is the
// category, and those paths move the seconds explicitly (moveRolledSeconds).

/** The summary day of an activity's startedAt — same expression the live summary queries group by. */
const dayOf = sql<string>`to_char(date_trunc('day', ${activities.startedAt}), 'YYYY-MM-DD')`;

interface SummaryKey {
  deviceId: string;
  day: string;
  app: string;
  context: string | null;
  categoryId: string | null;
}

/** Upserts `seconds` (possibly negative) into the summary row for `key`. */
async function addSeconds(db: Db, key: SummaryKey, seconds: number): Promise<void> {
  await db
    .insert(summaries)
    .values({ id: crypto.randomUUID(), ...key, seconds })
    .onConflictDoUpdate({
      target: [summaries.deviceId, summaries.day, summaries.app, summaries.context, summaries.categoryId],
      set: { seconds: sql`${summaries.seconds} + excluded.seconds` },
    });
}

/**
 * Folds every closed, not-yet-rolled activity into the summaries table and
 * marks it rolled. Idempotent: only the exact rows summed get marked, inside
 * one transaction. Returns how many activities were rolled.
 */
export async function rollupActivities(db: Db): Promise<number> {
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
      .where(and(isNotNull(activities.closedAt), eq(activities.rolledUp, false)));
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
    await tx
      .update(activities)
      .set({ rolledUp: true })
      .where(
        inArray(
          activities.id,
          rows.map((row) => row.id),
        ),
      );
    return rows.length;
  });
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
      { deviceId: row.deviceId, day: row.day, app: row.app, context: row.context, categoryId: null },
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

/**
 * Days of raw activities to keep. Summaries are never pruned, so history
 * charts survive; only per-activity detail (titles, re-categorization) ages
 * out. Set ACTIVITY_RETENTION_DAYS=0 to keep raw rows forever.
 */
export function retentionDays(): number {
  const configured = Number(process.env.ACTIVITY_RETENTION_DAYS);
  return Number.isFinite(configured) ? configured : 90;
}

/** How often the background rollup runs; also runs once at server start. */
export const ROLLUP_INTERVAL_MS = 15 * 60 * 1000;

export function startRollupTimer(db: Db): void {
  const run = async (): Promise<void> => {
    try {
      const rolled = await rollupActivities(db);
      if (rolled > 0) console.log(`rolled up ${rolled} activities`);
      // Prune only after rolling, so nothing is deleted before its seconds
      // are safely in a summary row.
      const pruned = await pruneActivities(db, retentionDays());
      if (pruned > 0) console.log(`pruned ${pruned} raw activities past retention`);
    } catch (error) {
      console.error('rollup failed', error);
    }
  };
  void run();
  setInterval(() => void run(), ROLLUP_INTERVAL_MS);
}
