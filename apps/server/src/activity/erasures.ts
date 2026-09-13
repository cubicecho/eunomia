import { and, eq, gt } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { type Erasure, erasures } from '../db/schema.ts';

// Erasures: the record that keeps deleted history deleted. The deletions in
// deletion.ts remove what the server holds; this is what stops an agent's
// outbox, or an import, from putting it back (see the table in db/schema.ts).
// Its own module so ingestion can consult it without importing the deletions,
// which themselves replay through ingestion's fold.

/**
 * The device's erasures that could cover any ping in `batch` — those ending
 * after its earliest capturedAt. For a live upload, whose pings are newer than
 * every deletion, that is none, and the index answers without reading a row.
 */
export async function erasuresFor(
  db: Db,
  deviceId: string,
  batch: { capturedAt: Date }[],
): Promise<Erasure[]> {
  if (batch.length === 0) return [];
  let earliest = batch[0]!.capturedAt;
  for (const { capturedAt } of batch) if (capturedAt < earliest) earliest = capturedAt;
  return db
    .select()
    .from(erasures)
    .where(and(eq(erasures.deviceId, deviceId), gt(erasures.to, earliest)));
}

/**
 * Whether a ping captured at `at` that folds into `entry` (its app and context
 * after context rules and merges — null for a ping with no app) was deleted.
 *
 * App erasures match the resolved entry rather than the raw app, because the
 * user purged what the dashboard showed them: a merged or context-divided name.
 */
export function isErased(
  list: Erasure[],
  at: Date,
  entry: { app: string; context: string | null } | null,
): boolean {
  return list.some((erasure) => {
    if (at >= erasure.to || (erasure.from && at < erasure.from)) return false;
    if (erasure.app === null) return true;
    if (!entry || entry.app !== erasure.app) return false;
    return erasure.context === null || erasure.context === entry.context;
  });
}
