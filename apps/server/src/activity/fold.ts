import { and, eq, isNull } from 'drizzle-orm';
import { activities } from '../db/schema.ts';
import type { Db } from '../db/client.ts';

/**
 * A stateless report from an agent: "this is what the device looks like right
 * now". The server owns all interpretation — the agent never tracks state.
 */
export interface Ping {
  capturedAt: Date;
  /** Foreground app identifier (executable name). Null if undetectable. */
  app: string | null;
  /** Foreground window title. Null if unavailable. */
  title: string | null;
  /** Seconds since last input, as reported by the OS. */
  idleSeconds: number;
}

/**
 * At most this many seconds accrue per ping — the gap since the device's last
 * ping, capped. Agents ping every ~10s, so this tolerates a couple of dropped
 * pings; a longer silence (sleep, shutdown, network gap) simply doesn't accrue.
 */
export const ACCRUE_CAP_SECONDS = 30;

/** Idle for at least this long counts as away rather than a reading pause. */
export const IDLE_THRESHOLD_SECONDS = 120;

/**
 * An open activity that hasn't been focused for this long is auto-closed.
 * Deliberately generous: rapid context switching (IDE ↔ browser every minute
 * for an hour) keeps both activities open and accruing — two rows, not a
 * hundred and twenty. Only a real departure closes an activity.
 */
export const CLOSE_AFTER_SECONDS = 15 * 60;

export type Activity = typeof activities.$inferSelect;

/**
 * Folds one ping into the device's open activities:
 *
 * - Each device has a SET of open activities (closedAt IS NULL), keyed by app.
 * - The elapsed time since the device's last ping (capped at ACCRUE_CAP_SECONDS)
 *   accrues to the currently focused app's open activity — created on first
 *   focus, revived-by-match on every return to it. Titles churn in place.
 * - Open activities unfocused for CLOSE_AFTER_SECONDS are closed at their
 *   lastActiveAt (their span never includes the silence after it).
 * - Idle pings accrue to nothing. The first ping past the idle threshold also
 *   walks back the focused activity's accrual to when input actually stopped,
 *   since the idle ramp-up (idleSeconds 0→threshold) was wrongly counted.
 *
 * Returns the activity the ping touched, or null (idle, or no detectable app).
 */
export async function foldPing(db: Db, deviceId: string, ping: Ping): Promise<Activity | null> {
  const now = ping.capturedAt;

  const open = await db
    .select()
    .from(activities)
    .where(and(eq(activities.deviceId, deviceId), isNull(activities.closedAt)));

  // Auto-close what has gone unfocused too long.
  const stale = open.filter(
    (a) => (now.getTime() - a.lastActiveAt.getTime()) / 1000 > CLOSE_AFTER_SECONDS,
  );
  if (stale.length > 0) {
    for (const a of stale) {
      await db
        .update(activities)
        .set({ closedAt: a.lastActiveAt })
        .where(eq(activities.id, a.id));
    }
  }
  const live = open.filter((a) => !stale.includes(a));

  const lastSeenMs = open.reduce((max, a) => Math.max(max, a.lastActiveAt.getTime()), 0);

  if (ping.idleSeconds >= IDLE_THRESHOLD_SECONDS) {
    // Walk the focused activity back to when input stopped: the ramp-up pings
    // (idle but under the threshold) accrued to it as if the user were there.
    const idleStart = new Date(now.getTime() - ping.idleSeconds * 1000);
    const focused = live.find((a) => a.lastActiveAt.getTime() === lastSeenMs);
    if (focused && focused.lastActiveAt.getTime() > idleStart.getTime()) {
      const overcount = (focused.lastActiveAt.getTime() - idleStart.getTime()) / 1000;
      await db
        .update(activities)
        .set({
          activeSeconds: Math.max(0, focused.activeSeconds - overcount),
          lastActiveAt: idleStart.getTime() > focused.startedAt.getTime()
            ? idleStart
            : focused.startedAt,
        })
        .where(eq(activities.id, focused.id));
    }
    return null;
  }

  if (!ping.app) return null;

  // Duplicate or out-of-order delivery — nothing to accrue.
  if (lastSeenMs > 0 && now.getTime() <= lastSeenMs) {
    return live.find((a) => a.app === ping.app) ?? null;
  }

  const delta =
    lastSeenMs > 0 ? Math.min((now.getTime() - lastSeenMs) / 1000, ACCRUE_CAP_SECONDS) : 0;

  const match = live.find((a) => a.app === ping.app);
  if (match) {
    const [updated] = await db
      .update(activities)
      .set({
        activeSeconds: match.activeSeconds + delta,
        lastActiveAt: now,
        title: ping.title ?? match.title,
      })
      .where(eq(activities.id, match.id))
      .returning();
    return updated!;
  }

  const [inserted] = await db
    .insert(activities)
    .values({
      id: crypto.randomUUID(),
      deviceId,
      app: ping.app,
      title: ping.title,
      startedAt: now,
      lastActiveAt: now,
      activeSeconds: delta,
    })
    .returning();
  return inserted!;
}
