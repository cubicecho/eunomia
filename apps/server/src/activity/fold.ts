import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { activities, type Device, devices } from '../db/schema.ts';

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
 * Takes the device's fold lock for the rest of the enclosing transaction, and
 * returns the device row as it stands under the lock (undefined if it's gone).
 *
 * Folding is a read-modify-write over the device's open activities, so two
 * uploads racing (a desktop retry overlapping the next tick, a phone syncing
 * while the laptop pings) could each read `activeSeconds: 100` and each write
 * back 110 — half the time silently lost. Locking the device row rather than
 * the activities serializes the whole fold including the insert of a first
 * activity, which has no row to lock yet. Replay takes the same lock, so a
 * rebuild and a live upload never interleave either.
 *
 * Contention is per device, which is exactly the granularity that matters: one
 * device's agent is the only writer of its own activities.
 */
export async function lockDevice(db: Db, deviceId: string): Promise<Device | undefined> {
  const [device] = await db.select().from(devices).where(eq(devices.id, deviceId)).for('update');
  return device;
}

/**
 * What one ping does to a device's open activities, as data. foldStep decides
 * it; foldPing writes it to the database and replay applies it in memory —
 * one definition of the fold, so a rebuilt history is the live one by
 * construction rather than by two implementations agreeing.
 */
export interface FoldStep {
  /** Open activities that went stale; each closes at its own lastActiveAt. */
  close: Activity[];
  /** An open activity as it stands after the ping, when the ping changed it. */
  update: Activity | null;
  /** An activity the ping opened. */
  insert: Activity | null;
  /** The activity the ping touched — the update, the insert, or an unchanged match. */
  touched: Activity | null;
}

/**
 * Folds one ping into a device's open activities:
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
 * Pure: `open` is every open activity of the device, and nothing is mutated.
 */
export function foldStep(open: Activity[], deviceId: string, ping: Ping): FoldStep {
  const now = ping.capturedAt;
  const none = { update: null, insert: null, touched: null };

  const close = open.filter(
    (a) => (now.getTime() - a.lastActiveAt.getTime()) / 1000 > CLOSE_AFTER_SECONDS,
  );
  const live = open.filter((a) => !close.includes(a));

  // Only activities still open count as "the last ping". A silence long enough
  // to close everything accrues nothing to the ping that ends it — and makes
  // the state after it the same as a device with no history at all, which is
  // the seam replay restarts from (see replay.ts).
  const lastSeenMs = live.reduce((max, a) => Math.max(max, a.lastActiveAt.getTime()), 0);

  if (ping.idleSeconds >= IDLE_THRESHOLD_SECONDS) {
    // Walk the focused activity back to when input stopped: the ramp-up pings
    // (idle but under the threshold) accrued to it as if the user were there.
    const idleStart = new Date(now.getTime() - ping.idleSeconds * 1000);
    const focused = live.find((a) => a.lastActiveAt.getTime() === lastSeenMs);
    if (focused && focused.lastActiveAt.getTime() > idleStart.getTime()) {
      const overcount = (focused.lastActiveAt.getTime() - idleStart.getTime()) / 1000;
      const update = {
        ...focused,
        activeSeconds: Math.max(0, focused.activeSeconds - overcount),
        lastActiveAt:
          idleStart.getTime() > focused.startedAt.getTime() ? idleStart : focused.startedAt,
      };
      return { close, ...none, update };
    }
    return { close, ...none };
  }

  if (!ping.app) return { close, ...none };

  const context = ping.context ?? null;
  const match = live.find((a) => a.app === ping.app && a.context === context);

  // Duplicate or out-of-order delivery — nothing to accrue.
  if (lastSeenMs > 0 && now.getTime() <= lastSeenMs) {
    return { close, ...none, touched: match ?? null };
  }

  const delta =
    lastSeenMs > 0 ? Math.min((now.getTime() - lastSeenMs) / 1000, ACCRUE_CAP_SECONDS) : 0;

  if (match) {
    const update = {
      ...match,
      activeSeconds: match.activeSeconds + delta,
      lastActiveAt: now,
      title: ping.title ?? match.title,
    };
    return { close, insert: null, update, touched: update };
  }

  const insert: Activity = {
    id: crypto.randomUUID(),
    deviceId,
    app: ping.app,
    context,
    title: ping.title,
    startedAt: now,
    lastActiveAt: now,
    activeSeconds: delta,
    closedAt: null,
    categoryId: null,
    categorySource: null,
    rolledUp: false,
  };
  return { close, update: null, insert, touched: insert };
}

/**
 * Folds one ping into the device's open activities in the database — see
 * foldStep for the rules. Returns the activity the ping touched, or null
 * (idle, or no detectable app).
 *
 * Read-modify-write throughout, so callers must hold the device's fold lock
 * (see lockDevice) — two concurrent pings from one device would otherwise both
 * read the same open row and both add their delta to it.
 */
export async function foldPing(db: Db, deviceId: string, ping: Ping): Promise<Activity | null> {
  const open = await db
    .select()
    .from(activities)
    .where(and(eq(activities.deviceId, deviceId), isNull(activities.closedAt)));

  const step = foldStep(open, deviceId, ping);

  // Each row closes at its own lastActiveAt, which is a column reference
  // rather than a value — so this is one statement for the whole set, not one
  // per row.
  if (step.close.length > 0) {
    await db
      .update(activities)
      .set({ closedAt: sql`${activities.lastActiveAt}` })
      .where(
        inArray(
          activities.id,
          step.close.map((a) => a.id),
        ),
      );
  }

  if (step.update) {
    const [updated] = await db
      .update(activities)
      .set({
        activeSeconds: step.update.activeSeconds,
        lastActiveAt: step.update.lastActiveAt,
        title: step.update.title,
      })
      .where(eq(activities.id, step.update.id))
      .returning();
    return step.touched ? updated! : null;
  }
  if (step.insert) {
    const [inserted] = await db.insert(activities).values(step.insert).returning();
    return inserted!;
  }
  return step.touched;
}
