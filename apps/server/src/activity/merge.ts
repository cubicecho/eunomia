import { and, eq, isNull, sql } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { activities, summaries } from '../db/schema.ts';
import { addSeconds } from './rollup.ts';

/**
 * Moves every trace of `sourceId` onto `targetId`, so the same machine
 * registered twice ends up as one device with one history. The caller deletes
 * the source device afterwards — which is only safe because nothing of its own
 * is left to cascade away.
 *
 * Two things stop it from being a plain re-point of deviceId:
 *
 * - Open activities. Fold keys them by (app, context) per device, and finds
 *   them with a `closedAt IS NULL` lookup that expects at most one per key —
 *   two open "code" rows on the target would accrue against whichever came back
 *   first. The source's are closed at their lastActiveAt (their time is already
 *   accrued; only the open-ended tail is given up) before they move.
 * - Summaries. Their unique key starts with deviceId, so a row that already
 *   exists on the target for the same day/app/context/category collides. Those
 *   are added into the target's row and dropped; the rest re-point.
 *
 * Returns how many activities moved.
 */
export async function mergeDeviceHistory(
  db: Db,
  sourceId: string,
  targetId: string,
): Promise<number> {
  return db.transaction(async (tx) => {
    await tx
      .update(activities)
      .set({ closedAt: sql`${activities.lastActiveAt}` })
      .where(and(eq(activities.deviceId, sourceId), isNull(activities.closedAt)));

    const moved = await tx
      .update(activities)
      .set({ deviceId: targetId })
      .where(eq(activities.deviceId, sourceId))
      .returning({ id: activities.id });

    const rows = await tx.select().from(summaries).where(eq(summaries.deviceId, sourceId));
    for (const row of rows) {
      await addSeconds(
        tx,
        {
          deviceId: targetId,
          day: row.day,
          app: row.app,
          context: row.context,
          categoryId: row.categoryId,
        },
        row.seconds,
      );
      await tx.delete(summaries).where(eq(summaries.id, row.id));
    }

    return moved.length;
  });
}
