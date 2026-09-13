import { eq, sql } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { type Device, devices } from '../db/schema.ts';
import { type ContextRule, extractContext, loadContextRules } from './context.ts';
import { erasuresFor, isErased } from './erasures.ts';
import { type Activity, foldPing, lockDevice, type Ping } from './fold.ts';
import { loadMergeRules, type MergeRule, mergeEntry } from './merge-rules.ts';
import { appendPings, logHead, type RawPing } from './ping-log.ts';
import { applyRules, type CategoryRule, loadRules } from './rules.ts';

// Ingestion: a raw ping in, the log appended, the derived rows moved on. The
// one path every source of pings takes — the agents' uploads today, importers
// tomorrow — so "what happens to a ping" has a single answer.

/** Every rule a fold consults, loaded once per batch or replay. */
export interface FoldRules {
  context: ContextRule[];
  category: CategoryRule[];
  merge: MergeRule[];
}

export async function loadFoldRules(db: Db, userId: string): Promise<FoldRules> {
  const [context, category, merge] = await Promise.all([
    loadContextRules(db, userId),
    loadRules(db, userId),
    loadMergeRules(db, userId),
  ]);
  return { context, category, merge };
}

/**
 * The ping the fold sees for a raw one: context extracted from the title when
 * the agent sent none, then the (app, context) pair run through the user's
 * merges. Pure, and shared by the live fold and replay — which is why the log
 * stores the raw ping and not this: a rebuild re-derives it under the rules
 * as they are now.
 */
export function resolvePing(rules: FoldRules, ping: RawPing): Ping {
  const context = ping.context ?? extractContext(rules.context, ping.app, ping.title);
  // Merges apply to the FINAL fold key, so after context extraction and to
  // both halves of it: the user merged what the dashboard showed them, which
  // is the (app, context) pair, not the raw app the agent reported.
  const entry = ping.app ? mergeEntry(rules.merge, { app: ping.app, context }) : null;
  return {
    capturedAt: ping.capturedAt,
    app: entry?.app ?? null,
    title: ping.title,
    context: entry ? entry.context : context,
    idleSeconds: ping.idleSeconds,
  };
}

/**
 * Records a device's pings: appends them to its raw log and folds what can be
 * folded live, all inside one transaction holding the device's fold lock.
 *
 * The lock is what makes a retried upload safe: a batch either lands whole or
 * not at all, and no other upload — or replay — of the same device interleaves
 * with it. Each ping then goes one of five ways:
 *
 * - **Deleted** — captured inside a range or app the user deleted (see
 *   erasures.ts) — is dropped unlogged: it is history the user already asked
 *   to be rid of, arriving late.
 * - **A duplicate** of one already logged is dropped: it was handled the first
 *   time it arrived.
 * - **Newer than the log's head** (or at it — a second ping in the same
 *   instant): folded live, in order. The overwhelmingly common case.
 * - **Older than the head** — backfill, an agent's late flush, an import — is
 *   logged but not folded: the fold only runs forwards, so folding it now
 *   would accrue nothing, or worse, walk back the wrong activity. The device's
 *   replayFrom is pulled back to it instead, and replay rebuilds from there
 *   (see replay.ts), putting the ping where it belongs.
 * - **Older than pingLogFrom** is logged and left: the derived rows there were
 *   folded from pings the log never had, so replay can't reach it either.
 *
 * Returns the activities the pings touched, in ping order, with nulls for the
 * pings that touched nothing (idle, no detectable app, or not folded live).
 */
export async function ingestPings(
  db: Db,
  device: Device,
  batch: RawPing[],
  rules?: FoldRules,
): Promise<(Activity | null)[]> {
  // Loaded before the lock: rules don't change what the lock protects, and
  // three queries not held against the device's next upload is worth it.
  const loaded = rules ?? (await loadFoldRules(db, device.userId));
  return db.transaction(async (tx) => {
    const locked = await lockDevice(tx, device.id);
    if (!locked) return batch.map(() => null);
    let head = await logHead(tx, device.id);
    // Under the lock, so a deletion either committed before this batch (and
    // its erasure drops the batch's pings from the deleted stretch) or runs
    // after it (and deletes them along with the rest).
    const erased = await erasuresFor(tx, device.id, batch);
    const keep = batch.map((ping) => {
      if (erased.length === 0) return true;
      const { app, context } = resolvePing(loaded, ping);
      return !isErased(erased, ping.capturedAt, app ? { app, context: context ?? null } : null);
    });
    const stored = await appendPings(
      tx,
      device.id,
      batch.filter((_, i) => keep[i]),
      head,
    );
    let next = 0;
    const appended = keep.map((kept) => kept && stored[next++]!);

    const touched: (Activity | null)[] = [];
    let backfillFrom: Date | null = null;
    for (const [i, ping] of batch.entries()) {
      const at = ping.capturedAt;
      if (!appended[i] || (locked.pingLogFrom && at < locked.pingLogFrom)) {
        touched.push(null);
      } else if (head && at < head) {
        if (!backfillFrom || at < backfillFrom) backfillFrom = at;
        touched.push(null);
      } else {
        touched.push(await foldOne(tx, device.id, loaded, ping));
        head = at;
      }
    }

    if (backfillFrom) {
      await tx
        .update(devices)
        .set({
          replayFrom: sql`least(${devices.replayFrom}, ${backfillFrom.toISOString()}::timestamptz)`,
        })
        .where(eq(devices.id, device.id));
    }
    return touched;
  });
}

async function foldOne(
  tx: Db,
  deviceId: string,
  rules: FoldRules,
  ping: RawPing,
): Promise<Activity | null> {
  const activity = await foldPing(tx, deviceId, resolvePing(rules, ping));
  if (!activity) return null;
  // Lazy auto-categorization: every ping re-evaluates the touched row, so new
  // rows, title churn, and rule changes all converge here.
  return applyRules(tx, rules.category, activity);
}
