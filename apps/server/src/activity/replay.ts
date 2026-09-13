import { and, asc, desc, eq, gte, isNotNull, isNull, lte, notExists, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { Db } from '../db/client.ts';
import { activities, type Device, devices, pings } from '../db/schema.ts';
import { type Activity, CLOSE_AFTER_SECONDS, foldStep, lockDevice } from './fold.ts';
import { type FoldRules, loadFoldRules, resolvePing } from './ingest.ts';
import { readPings } from './ping-log.ts';
import { dropEmptySummaries, rollupActivities, unrollActivities } from './rollup.ts';
import { categorize } from './rules.ts';

// Replay: rebuilding a device's activities and summaries from its raw ping log.
// Live ingestion folds each ping once, as it arrives, and only forwards; replay
// re-runs that same fold (foldStep, resolvePing, categorize — the very functions
// ingestion uses) over the stored pings in capturedAt order. It's how a
// backfilled ping lands where it belongs, and how the derived rows are
// recomputed after anything that changes them wholesale.

/** Rows per INSERT when writing rebuilt activities back. */
const WRITE_CHUNK = 1000;

export interface ReplayResult {
  /** Where the rebuild started — the seam it restarted the fold at — or null when there was nothing to replay. */
  from: Date | null;
  /** Pings folded. */
  pings: number;
  /** Activities the rebuild wrote. */
  activities: number;
}

export interface ReplayOptions {
  /**
   * Rebuild everything from here on. Replay actually starts at the nearest
   * seam at or before it (see findSeam), so a little before `from` is rebuilt
   * too. Omitted: the whole replayable log.
   */
  from?: Date;
}

/**
 * The ping replay restarts the fold at for `target`: a ping whose fold state is
 * provably empty, so starting from nothing reproduces the live fold exactly.
 *
 * That holds after a silence longer than CLOSE_AFTER_SECONDS — every open
 * activity is stale by then, the ping closes them all, and accrues nothing
 * (fold.ts takes lastSeen only from activities still open). So a seam is a ping
 * with no other ping in the CLOSE_AFTER_SECONDS before it, that is also far
 * enough past pingLogFrom that no unlogged ping can have left anything open.
 *
 * The latest seam at or before `target`, or failing that (or with no target)
 * the earliest one. Null when the log has no seam at all. Both are index walks
 * down the primary key that stop at the first hit, and a device idle overnight
 * has a seam a day, so neither reads more than about a day of pings.
 */
async function findSeam(
  db: Db,
  device: Device,
  target: Date | null,
): Promise<{ at: Date; earliest: boolean } | null> {
  const seamAt = async (before: Date | null): Promise<Date | null> => {
    const q = alias(pings, 'q');
    const window = sql`make_interval(secs => ${CLOSE_AFTER_SECONDS})`;
    const order = before ? desc : asc;
    const [row] = await db
      .select({ capturedAt: pings.capturedAt })
      .from(pings)
      .where(
        and(
          eq(pings.deviceId, device.id),
          before ? lte(pings.capturedAt, before) : undefined,
          device.pingLogFrom
            ? sql`${pings.capturedAt} > ${device.pingLogFrom.toISOString()}::timestamptz + ${window}`
            : undefined,
          notExists(
            db
              .select({ one: sql`1` })
              .from(q)
              .where(
                and(
                  eq(q.deviceId, pings.deviceId),
                  sql`${q.capturedAt} >= ${pings.capturedAt} - ${window}`,
                  sql`(${q.capturedAt}, ${q.seq}) < (${pings.capturedAt}, ${pings.seq})`,
                ),
              ),
          ),
        ),
      )
      .orderBy(order(pings.capturedAt), order(pings.seq))
      .limit(1);
    return row?.capturedAt ?? null;
  };
  if (target) {
    const at = await seamAt(target);
    if (at) return { at, earliest: false };
  }
  const at = await seamAt(null);
  return at ? { at, earliest: true } : null;
}

const assignmentKey = (a: Pick<Activity, 'app' | 'context' | 'startedAt'>): string =>
  `${a.app}\n${a.context ?? '\0'}\n${a.startedAt.getTime()}`;

/**
 * Rebuilds a device's activities and summaries from its raw ping log, from the
 * seam at or before `options.from` onwards, under the current rules.
 *
 * One transaction holding the device's fold lock: uploads from the device wait
 * for it (the agents retry), and nothing else can see a half-rebuilt history.
 *
 * - Summaries for time before the seam are untouched — including days whose
 *   raw activities and pings are long pruned. Rolled activities from the seam
 *   on have their seconds taken back out of the summaries first, so the
 *   rebuilt rows can roll back in without counting twice.
 * - Manual category assignments carry over to the rebuilt activity with the
 *   same (app, context, startedAt); an activity the rebuild changed the start
 *   of loses its assignment and is categorized by the rules.
 * - Activity ids change: every rebuilt row is a new row.
 *
 * Clears the device's pending replayFrom when this rebuild covered it.
 */
export async function replayDevice(
  db: Db,
  deviceId: string,
  options: ReplayOptions = {},
): Promise<ReplayResult> {
  const rules = await loadRulesFor(db, deviceId);
  return db.transaction(async (tx) => {
    const device = await lockDevice(tx, deviceId);
    const nothing = { from: null, pings: 0, activities: 0 };
    if (!device || !rules) return nothing;

    const seam = await findSeam(tx, device, options.from ?? null);
    // Whether this rebuild reached everything pending: it started at or before
    // the earliest backfilled ping, or that ping sits before the first seam
    // and no replay ever could.
    const covered = !device.replayFrom || !seam || seam.earliest || seam.at <= device.replayFrom;
    if (covered && device.replayFrom) {
      await tx.update(devices).set({ replayFrom: null }).where(eq(devices.id, deviceId));
    }
    if (!seam) return nothing;
    const from = seam.at;

    const manual = new Map<string, string | null>();
    const assigned = await tx
      .select({
        app: activities.app,
        context: activities.context,
        startedAt: activities.startedAt,
        categoryId: activities.categoryId,
      })
      .from(activities)
      .where(
        and(
          eq(activities.deviceId, deviceId),
          gte(activities.startedAt, from),
          eq(activities.categorySource, 'manual'),
        ),
      );
    for (const row of assigned) manual.set(assignmentKey(row), row.categoryId);

    await unrollActivities(tx, deviceId, from);
    await tx
      .delete(activities)
      .where(and(eq(activities.deviceId, deviceId), gte(activities.startedAt, from)));
    // Whatever is still open started before the seam and is stale at it: the
    // seam ping would close it at its lastActiveAt, so close it the same way.
    await tx
      .update(activities)
      .set({ closedAt: sql`${activities.lastActiveAt}` })
      .where(and(eq(activities.deviceId, deviceId), isNull(activities.closedAt)));

    const open = new Map<string, Activity>();
    let closed: Activity[] = [];
    let written = 0;
    let folded = 0;
    const flush = async (rows: Activity[]): Promise<void> => {
      for (let i = 0; i < rows.length; i += WRITE_CHUNK) {
        await tx.insert(activities).values(rows.slice(i, i + WRITE_CHUNK));
      }
      written += rows.length;
    };

    for await (const page of readPings(tx, deviceId, from)) {
      for (const stored of page) {
        folded++;
        const step = foldStep([...open.values()], deviceId, resolvePing(rules, stored));
        for (const row of step.close) {
          open.delete(row.id);
          closed.push({ ...row, closedAt: row.lastActiveAt });
        }
        if (step.update) open.set(step.update.id, step.update);
        if (step.insert) {
          const categoryId = manual.get(assignmentKey(step.insert));
          open.set(
            step.insert.id,
            categoryId === undefined
              ? step.insert
              : { ...step.insert, categoryId, categorySource: 'manual' },
          );
        }
        if (step.touched) {
          // As ingestion does: the rules run on every row a ping touches.
          const current = open.get(step.touched.id) ?? step.touched;
          open.set(current.id, categorize(rules.category, current));
        }
      }
      if (closed.length >= WRITE_CHUNK) {
        await flush(closed);
        closed = [];
      }
    }
    await flush([...closed, ...open.values()]);

    await rollupActivities(tx, deviceId);
    await dropEmptySummaries(tx, deviceId);
    return { from, pings: folded, activities: written };
  });
}

/** The fold rules of the device's owner, or null if the device is gone. */
async function loadRulesFor(db: Db, deviceId: string): Promise<FoldRules | null> {
  const [device] = await db
    .select({ userId: devices.userId })
    .from(devices)
    .where(eq(devices.id, deviceId));
  return device ? loadFoldRules(db, device.userId) : null;
}

/**
 * Replays every device with backfilled pings waiting (replayFrom set), each
 * from its earliest pending ping. Returns how many devices were replayed.
 * One device's failure doesn't stop the others.
 */
export async function replayPending(db: Db): Promise<number> {
  const pending = await db
    .select({ id: devices.id, replayFrom: devices.replayFrom })
    .from(devices)
    .where(isNotNull(devices.replayFrom));
  let replayed = 0;
  for (const { id, replayFrom } of pending) {
    try {
      await replayDevice(db, id, { from: replayFrom! });
      replayed++;
    } catch (error) {
      console.error(`replay of device ${id} failed`, error);
    }
  }
  return replayed;
}

/**
 * How often pending replays run. Backfill is rare and never urgent — an agent
 * flushing a backlog sends it in a burst of batches, and waiting out the burst
 * rebuilds once instead of once per batch.
 */
export const REPLAY_INTERVAL_MS = 60 * 1000;

export function startReplayTimer(db: Db): void {
  let running = false;
  const run = async (): Promise<void> => {
    // A long rebuild can outlast the interval; two passes would only queue on
    // the same device locks.
    if (running) return;
    running = true;
    try {
      const replayed = await replayPending(db);
      if (replayed > 0) console.log(`replayed ${replayed} device(s) with backfilled pings`);
    } catch (error) {
      console.error('replay failed', error);
    } finally {
      running = false;
    }
  };
  void run();
  setInterval(() => void run(), REPLAY_INTERVAL_MS);
}
