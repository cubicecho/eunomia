import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { activities, devices } from '../db/schema.ts';

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
  /**
   * Sub-app division the activity is also keyed by: browser hostname
   * (agent-supplied) or project/document extracted from the title by the
   * user's context rules — resolved by the caller before folding. Null = no
   * finer division than the app.
   */
  context?: string | null;
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
 * Takes the device's fold lock for the rest of the enclosing transaction.
 *
 * Folding is a read-modify-write over the device's open activities, so two
 * uploads racing (a desktop retry overlapping the next tick, a phone syncing
 * while the laptop pings) could each read `activeSeconds: 100` and each write
 * back 110 — half the time silently lost. Locking the device row rather than
 * the activities serializes the whole fold including the insert of a first
 * activity, which has no row to lock yet.
 *
 * Contention is per device, which is exactly the granularity that matters: one
 * device's agent is the only writer of its own activities.
 */
export async function lockDevice(db: Db, deviceId: string): Promise<void> {
  await db.select({ id: devices.id }).from(devices).where(eq(devices.id, deviceId)).for('update');
}

/**
 * Folds one ping into the device's open activities:
 *
 * - Each device has a SET of open activities (closedAt IS NULL), keyed by
 *   (app, context).
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
 *
 * Read-modify-write throughout, so callers must hold the device's fold lock
 * (see lockDevice) — two concurrent pings from one device would otherwise both
 * read the same open row and both add their delta to it.
 */
export async function foldPing(db: Db, deviceId: string, ping: Ping): Promise<Activity | null> {
  const now = ping.capturedAt;

  const open = await db
    .select()
    .from(activities)
    .where(and(eq(activities.deviceId, deviceId), isNull(activities.closedAt)));

  // Auto-close what has gone unfocused too long. Each row closes at its own
  // lastActiveAt, which is a column reference rather than a value — so this is
  // one statement for the whole set, not one per row.
  const staleIds = new Set(
    open
      .filter((a) => (now.getTime() - a.lastActiveAt.getTime()) / 1000 > CLOSE_AFTER_SECONDS)
      .map((a) => a.id),
  );
  if (staleIds.size > 0) {
    await db
      .update(activities)
      .set({ closedAt: sql`${activities.lastActiveAt}` })
      .where(inArray(activities.id, [...staleIds]));
  }
  const live = open.filter((a) => !staleIds.has(a.id));

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
          lastActiveAt:
            idleStart.getTime() > focused.startedAt.getTime() ? idleStart : focused.startedAt,
        })
        .where(eq(activities.id, focused.id));
    }
    return null;
  }

  if (!ping.app) return null;

  const context = ping.context ?? null;
  const sameKey = (a: Activity) => a.app === ping.app && a.context === context;

  // Duplicate or out-of-order delivery — nothing to accrue.
  if (lastSeenMs > 0 && now.getTime() <= lastSeenMs) {
    return live.find(sameKey) ?? null;
  }

  const delta =
    lastSeenMs > 0 ? Math.min((now.getTime() - lastSeenMs) / 1000, ACCRUE_CAP_SECONDS) : 0;

  const match = live.find(sameKey);
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
      context,
      title: ping.title,
      startedAt: now,
      lastActiveAt: now,
      activeSeconds: delta,
    })
    .returning();
  return inserted!;
}
