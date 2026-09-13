import { and, asc, desc, eq, gte, lt, lte, sql } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { devices, erasures, pings, type StoredPing, user } from '../db/schema.ts';
import { lockDevice } from './fold.ts';
import { retentionCutoff } from './rollup.ts';

// The raw ping log: the append-only record every derived row is folded from.
// This module is only the table — appending, reading back in fold order, and
// pruning. What a ping MEANS lives in fold.ts and ingest.ts; rebuilding from
// the log lives in replay.ts.

/** A ping as the log stores it: what the agent sent, with capturedAt parsed. */
export interface RawPing {
  capturedAt: Date;
  app: string | null;
  title: string | null;
  /** Agent-supplied only. Rule-extracted context is derived, so it's never stored. */
  context: string | null;
  idleSeconds: number;
}

/** Rows per INSERT — keeps an importer's large append under the bind-parameter limit. */
const INSERT_CHUNK = 1000;

/** Identity of a ping for de-duplication: every field, nulls distinct from strings. */
const keyOf = (ping: RawPing): string =>
  [
    ping.capturedAt.getTime(),
    ping.app ?? '\0',
    ping.title ?? '\0',
    ping.context ?? '\0',
    ping.idleSeconds,
  ].join('\n');

/** The latest capturedAt in the device's log, or null for an empty log. */
export async function logHead(db: Db, deviceId: string): Promise<Date | null> {
  // The newest row by primary key rather than max(): one index probe.
  const [row] = await db
    .select({ capturedAt: pings.capturedAt })
    .from(pings)
    .where(eq(pings.deviceId, deviceId))
    .orderBy(desc(pings.capturedAt))
    .limit(1);
  return row?.capturedAt ?? null;
}

/**
 * Appends pings to the device's log in the order given, skipping exact
 * duplicates — of a ping already stored, or of one earlier in the same list.
 * Returns, per ping, whether it was stored.
 *
 * Duplicates are what at-least-once delivery produces: an agent that crashed
 * before recording an acknowledgement sends the same batch again. Skipping
 * them here is what keeps a retry from doubling the log (and an export of it).
 * Two DIFFERENT pings at one instant are both kept, in arrival order — the
 * Android agent emits a closing and an opening ping at the same millisecond.
 *
 * `head` is the log's head before this append (see logHead). Only a list that
 * reaches back to it can collide with what's stored, so the live path — every
 * ping newer than the last — never pays for the lookup. Call with the device's
 * fold lock held, or two appends can each miss the other's duplicates.
 */
export async function appendPings(
  db: Db,
  deviceId: string,
  batch: RawPing[],
  head: Date | null,
): Promise<boolean[]> {
  if (batch.length === 0) return [];
  // A loop, not Math.min(...): an importer's list can outgrow the argument limit.
  let earliest = batch[0]!.capturedAt;
  let latest = earliest;
  for (const { capturedAt } of batch) {
    if (capturedAt < earliest) earliest = capturedAt;
    if (capturedAt > latest) latest = capturedAt;
  }

  const seen = new Set<string>();
  if (head && earliest.getTime() <= head.getTime()) {
    const stored = await db
      .select({
        capturedAt: pings.capturedAt,
        app: pings.app,
        title: pings.title,
        context: pings.context,
        idleSeconds: pings.idleSeconds,
      })
      .from(pings)
      .where(
        and(
          eq(pings.deviceId, deviceId),
          gte(pings.capturedAt, earliest),
          lte(pings.capturedAt, latest),
        ),
      );
    for (const ping of stored) seen.add(keyOf(ping));
  }

  const rows: (RawPing & { deviceId: string })[] = [];
  const appended = batch.map((ping) => {
    const key = keyOf(ping);
    if (seen.has(key)) return false;
    seen.add(key);
    rows.push({ deviceId, ...ping });
    return true;
  });
  for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
    await db.insert(pings).values(rows.slice(i, i + INSERT_CHUNK));
  }
  return appended;
}

/**
 * The device's pings from `from` on, in fold order — capturedAt, then arrival
 * within an instant — a page at a time, so a rebuild over months of history
 * never holds the whole log in memory.
 */
export async function* readPings(
  db: Db,
  deviceId: string,
  from: Date,
  pageSize = 5000,
): AsyncGenerator<StoredPing[]> {
  let after: StoredPing | null = null;
  for (;;) {
    const page: StoredPing[] = await db
      .select()
      .from(pings)
      .where(
        and(
          eq(pings.deviceId, deviceId),
          gte(pings.capturedAt, from),
          // Keyset on the primary key, which is also its order.
          after
            ? sql`(${pings.capturedAt}, ${pings.seq}) > (${after.capturedAt.toISOString()}::timestamptz, ${after.seq})`
            : undefined,
        ),
      )
      .orderBy(asc(pings.capturedAt), asc(pings.seq))
      .limit(pageSize);
    if (page.length > 0) yield page;
    if (page.length < pageSize) return;
    after = page.at(-1)!;
  }
}

/**
 * Deletes raw pings older than their owner's retention — the server's
 * `retentionDays`, or fewer where the user chose fewer (ownerRetentionDays) —
 * device by device, and moves each pruned device's pingLogFrom up to its
 * cutoff: the log is no longer complete before it, so replay must not start
 * there. The device's erasures that end before the cutoff go too; a ping that
 * old is pruned whether or not one stops it. A non-positive `retentionDays`
 * keeps everything for users who haven't asked for less. Returns how many
 * pings were deleted.
 *
 * The same cutoff as pruneActivities, which is what lets replay trust the
 * boundary: every activity old enough to have been pruned started before
 * pingLogFrom, so no rebuild ever re-creates time a summary already holds.
 *
 * Per device under its fold lock, so a prune never deletes pings out from
 * under a replay that is part-way through reading them.
 */
export async function prunePings(db: Db, retentionDays: number): Promise<number> {
  const now = new Date();
  const owned = await db
    .select({ id: devices.id, cutoff: retentionCutoff(retentionDays, now) })
    .from(devices)
    .innerJoin(user, eq(devices.userId, user.id));
  let deleted = 0;
  for (const { id, cutoff: raw } of owned) {
    if (raw === null) continue;
    // Selected through sql``, so it arrives as the driver's text, not a Date.
    const cutoff = new Date(raw);
    deleted += await db.transaction(async (tx) => {
      const device = await lockDevice(tx, id);
      if (!device) return 0;
      await tx.delete(erasures).where(and(eq(erasures.deviceId, id), lt(erasures.to, cutoff)));
      const gone = await tx
        .delete(pings)
        .where(and(eq(pings.deviceId, id), lt(pings.capturedAt, cutoff)))
        .returning({ seq: pings.seq });
      if (gone.length > 0) {
        await tx
          .update(devices)
          .set({
            pingLogFrom: sql`greatest(${devices.pingLogFrom}, ${cutoff.toISOString()}::timestamptz)`,
          })
          .where(eq(devices.id, id));
      }
      return gone.length;
    });
  }
  return deleted;
}
