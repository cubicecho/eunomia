import { and, desc, eq, gt, inArray } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { type FocusSegment, focusSegments } from '../db/schema.ts';
import type { FoldStep } from './fold.ts';

// Focus segments: the order the fold credited time in (see the table's comment
// in schema.ts for what a segment is). Like the fold itself, the rules are one
// pure function — focusStep — with two drivers: recordFocus writes its result
// to the database for a live ping, and replay applies it in memory. So a
// rebuilt timeline is the live one by construction.

/** What one fold step does to the device's focus segments, as data. */
export interface FocusStep {
  /** A segment the ping started. */
  insert: FocusSegment | null;
  /** Existing segments as they stand after the ping: extended, or cut short by idle. */
  update: FocusSegment[];
  /** Segments that turned out to start after input had already stopped. */
  remove: FocusSegment[];
}

/**
 * The effect of a fold step on focus segments. `segments` must hold, at least,
 * the latest segment of an activity the step accrued to and every segment
 * ending after the walk-back instant of an activity it walked back. Anything
 * else in it is ignored, so a caller can pass more than that: replay passes
 * every segment it holds for those activities.
 *
 * - An accrual extends the activity's latest segment when that segment ends
 *   exactly where the accrual starts, and otherwise starts a new segment
 *   covering the accrual. A gap past ACCRUE_CAP_SECONDS, or a return to the
 *   activity after focusing something else, therefore starts a new one.
 * - A walk-back cuts the activity's segments at the instant input stopped, the
 *   same instant the fold cuts its lastActiveAt at, and removes the ones that
 *   started after it: the user wasn't there for them.
 *
 * Pure: nothing in `segments` or `step` is mutated.
 */
export function focusStep(segments: FocusSegment[], step: FoldStep): FocusStep {
  const out: FocusStep = { insert: null, update: [], remove: [] };

  if (step.accrued) {
    const { activity, from } = step.accrued;
    const latest = segments
      .filter((s) => s.activityId === activity.id)
      .reduce<FocusSegment | null>((a, b) => (a && a.startedAt >= b.startedAt ? a : b), null);
    if (latest && latest.endedAt.getTime() === from.getTime()) {
      out.update.push({ ...latest, endedAt: activity.lastActiveAt });
    } else {
      out.insert = {
        id: crypto.randomUUID(),
        deviceId: activity.deviceId,
        activityId: activity.id,
        startedAt: from,
        endedAt: activity.lastActiveAt,
      };
    }
  }

  if (step.walkedBack) {
    const { activity, to } = step.walkedBack;
    for (const segment of segments) {
      if (segment.activityId !== activity.id || segment.endedAt <= to) continue;
      if (segment.startedAt >= to) out.remove.push(segment);
      else out.update.push({ ...segment, endedAt: to });
    }
  }

  return out;
}

/**
 * Applies a live fold step to the device's focus segments in the database —
 * see focusStep for the rules. Call after the step's activities are written
 * (a new segment references its activity), under the device's fold lock.
 *
 * Reads only what focusStep needs: one row for an accrual, and for a walk-back
 * the few segments of that activity inside the idle ramp.
 */
export async function recordFocus(db: Db, step: FoldStep): Promise<void> {
  const segments: FocusSegment[] = [];
  if (step.accrued) {
    segments.push(
      ...(await db
        .select()
        .from(focusSegments)
        .where(eq(focusSegments.activityId, step.accrued.activity.id))
        .orderBy(desc(focusSegments.startedAt))
        .limit(1)),
    );
  }
  if (step.walkedBack) {
    segments.push(
      ...(await db
        .select()
        .from(focusSegments)
        .where(
          and(
            eq(focusSegments.activityId, step.walkedBack.activity.id),
            gt(focusSegments.endedAt, step.walkedBack.to),
          ),
        )),
    );
  }

  const focus = focusStep(segments, step);
  if (focus.insert) await db.insert(focusSegments).values(focus.insert);
  for (const segment of focus.update) {
    await db
      .update(focusSegments)
      .set({ endedAt: segment.endedAt })
      .where(eq(focusSegments.id, segment.id));
  }
  if (focus.remove.length > 0) {
    await db.delete(focusSegments).where(
      inArray(
        focusSegments.id,
        focus.remove.map((s) => s.id),
      ),
    );
  }
}
