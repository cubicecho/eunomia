import { asc, eq, sql } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { devices, user } from '../db/schema.ts';
import { badInput } from '../errors.ts';
import { ownerZone, rebucketSummaries } from './rollup.ts';

// Per-user time zones: which midnight a user's days split at. Every "day" in
// the system — summaries.day, and the whole-day windows the dashboard asks
// for — is computed in SQL from the owner's zone (rollup.ts ownerZone), so
// this module only has to decide what a valid zone is and what changing one
// does to the days already on file.

export interface UserTimeZone {
  id: string;
  /** What the user chose, or null to follow the server. */
  timeZone: string | null;
  /** The zone their days actually split in: theirs, or the server's session zone. */
  effectiveTimeZone: string;
}

/** The user's zone as `me` reports it, or undefined if there is no such user. */
export async function loadUserTimeZone(db: Db, userId: string): Promise<UserTimeZone | undefined> {
  const [row] = await db
    .select({ id: user.id, timeZone: user.timeZone, effectiveTimeZone: ownerZone })
    .from(user)
    .where(eq(user.id, userId));
  return row;
}

/**
 * The zone name as it will be stored, or a thrown BAD_USER_INPUT.
 *
 * Two parties have to agree on it. The dashboard computes dates in the zone
 * with Intl, which throws on a name it doesn't know, so Intl has to take it —
 * and its canonical spelling is what gets stored. Postgres does the arithmetic
 * (`at time zone`), and it accepts things that aren't zones for this purpose
 * (an abbreviation is a fixed offset that never observes DST; a POSIX string
 * like `UTC+5` means UTC-5), so the stored name also has to be one of its
 * pg_timezone_names, exactly. What both accept is the IANA database, which is
 * what a browser reports as its own zone.
 */
export async function validTimeZone(db: Db, name: string): Promise<string> {
  const trimmed = name.trim();
  const invalid = () => badInput(`Unknown time zone ${JSON.stringify(trimmed)}; use an IANA name`);
  let canonical: string;
  try {
    // Intl's own spelling of it — 'america/chicago' is America/Chicago, and a
    // legacy link like US/Central is the zone it links to — so one zone is
    // stored one way however it was typed.
    canonical = new Intl.DateTimeFormat('en', { timeZone: trimmed }).resolvedOptions().timeZone;
  } catch {
    throw invalid();
  }
  const [known] = await db
    .select({ name: sql<string>`name` })
    .from(sql`pg_timezone_names`)
    .where(sql`name = ${canonical}`)
    .limit(1);
  if (!known) throw invalid();
  return known.name;
}

/**
 * Sets (or, with null, clears) a user's zone, and moves the days already on
 * file that the change affects: every rolled activity still kept is
 * re-bucketed from the old zone's day to the new one's (rebucketSummaries).
 * Summaries whose raw activities have been pruned stay on the day they were
 * bucketed into — nothing records which instants they came from.
 *
 * One transaction, holding every one of the user's device locks and then
 * their user row:
 * - the device locks keep ingestion and replay out, since replay takes
 *   seconds back out of summaries by the day it computes, and one that
 *   straddled the change would take them from the wrong day;
 * - the row lock keeps the rollup timer out, which reads the owner's zone
 *   FOR SHARE (rollupActivities) — so a rollup either finishes first and its
 *   rows are re-bucketed here, or starts after and buckets in the new zone.
 * Devices before user, the same order replay ends up in (its rollup reads
 * the user row under the device lock), so neither can deadlock the other.
 */
export async function setUserTimeZone(
  db: Db,
  userId: string,
  timeZone: string | null,
): Promise<UserTimeZone | undefined> {
  const next = timeZone === null ? null : await validTimeZone(db, timeZone);
  await db.transaction(async (tx) => {
    await tx
      .select({ id: devices.id })
      .from(devices)
      .where(eq(devices.userId, userId))
      .orderBy(asc(devices.id))
      .for('update');
    const [current] = await tx
      .select({ timeZone: user.timeZone })
      .from(user)
      .where(eq(user.id, userId))
      .for('update');
    if (!current || current.timeZone === next) return;

    const effective = (zone: string | null) =>
      sql`coalesce(${zone}::text, current_setting('TimeZone'))`;
    await rebucketSummaries(tx, userId, effective(current.timeZone), effective(next));
    await tx.update(user).set({ timeZone: next }).where(eq(user.id, userId));
  });
  return loadUserTimeZone(db, userId);
}
