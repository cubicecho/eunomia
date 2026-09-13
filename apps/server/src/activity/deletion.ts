import { and, asc, eq, gte, inArray, like, lt, lte, sql } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import {
  activities,
  apikey,
  type Device,
  devices,
  erasures,
  pings,
  summaries,
  user,
  verification,
} from '../db/schema.ts';
import { badInput } from '../errors.ts';
import { loadFoldRules, resolvePing } from './ingest.ts';
import { findSeam, replayDevice } from './replay.ts';
import { dayOf, dropEmptySummaries, ownerJoin, unrollActivities } from './rollup.ts';
import { loadUserTimeZone } from './time-zone.ts';

// Deletion the user asks for: a stretch of time, an app, or the whole account.
// Everything here takes the same locks as a time zone change (setUserTimeZone)
// and in the same order — the devices' fold locks by id, then the user row —
// so ingestion and replay of the devices wait, the rollup timer (which reads
// the owner FOR SHARE, rollupActivities) can't roll a row between this reading
// the summaries and deleting what they were rolled from, and none of them can
// deadlock with another.
//
// Each also writes an erasure (see erasures.ts): deleting what the server
// holds isn't enough while an agent's outbox still has pings from that
// stretch, and the next upload would put them back.

/** Pings per DELETE in purgeApp — well under Postgres's 65535 bind parameters. */
const DELETE_CHUNK = 5000;

/** The longest range deleteRange takes: a century. */
const MAX_RANGE_MS = 100 * 366 * 24 * 60 * 60 * 1000;

/** Every one of the user's devices — or just `deviceId` of them — locked, in id order. */
async function lockDevices(tx: Db, userId: string, deviceId?: string): Promise<Device[]> {
  const locked = await tx
    .select()
    .from(devices)
    .where(and(eq(devices.userId, userId), deviceId ? eq(devices.id, deviceId) : undefined))
    .orderBy(asc(devices.id))
    .for('update');
  await tx.select({ id: user.id }).from(user).where(eq(user.id, userId)).for('update');
  return locked;
}

export interface RangeDeletion {
  /** Devices the range was deleted from. */
  devices: number;
  /** Raw pings deleted. */
  pings: number;
  /** Whole calendar days inside the range, whose summaries were deleted outright. */
  days: number;
  /**
   * Days, 'YYYY-MM-DD' in the user's zone, that the range only partly covers
   * and that still hold time the range may have included — see deleteRange.
   */
  partialDays: string[];
}

/**
 * Deletes everything recorded in [from, to) on one of the user's devices, or
 * on all of them. Returns undefined when `deviceId` isn't theirs.
 *
 * What "everything" can mean depends on what the server still has to go on:
 *
 * - **Where the ping log covers** — from a replay seam on (replay.ts
 *   findSeam) — the range's pings are deleted and the device is replayed over
 *   what's left, so its activities, focus segments and summaries come out
 *   exactly as if the range had never been recorded, up to the one gap the
 *   fold bridges at each edge (at most ACCRUE_CAP_SECONDS).
 * - **Where it doesn't** — raw pings pruned, or history that never had pings
 *   (a RescueTime import, a restored bundle) — only whole rows can go:
 *   activities that started inside the range, and the summaries of every
 *   calendar day the range covers whole. A summary row is a day's total and
 *   nothing records which instants it came from, so a day the range covers
 *   only part of keeps whatever of it can't be traced to an activity row.
 *   Those days are reported in partialDays, so the dashboard can say so
 *   instead of implying the time is gone.
 *
 * An activity that started before `from` and ran into the range keeps its
 * seconds in the uncovered stretch for the same reason: it is one row.
 */
export async function deleteRange(
  db: Db,
  userId: string,
  range: { from: Date; to: Date; deviceId?: string },
): Promise<RangeDeletion | undefined> {
  const { from, to } = range;
  if (!(from < to)) throw badInput('The range must end after it starts');
  // Days are enumerated one row each; this bounds that at a few tens of
  // thousands while still allowing "everything since 1970".
  if (to.getTime() - from.getTime() > MAX_RANGE_MS) throw badInput('That range is too long');
  return db.transaction(async (tx) => {
    const locked = await lockDevices(tx, userId, range.deviceId);
    if (range.deviceId && locked.length === 0) return undefined;
    // Stable while the device locks are held: changing it takes them too.
    const zone = (await loadUserTimeZone(tx, userId))?.effectiveTimeZone;
    if (!zone) return undefined;
    const days = await daysTouching(tx, zone, from, to);
    const whole = days.filter((day) => day.start >= from.getTime() && day.end <= to.getTime());
    const partial = days.filter((day) => !whole.includes(day));
    const now = new Date();

    let deletedPings = 0;
    const partialDays = new Set<string>();
    for (const device of locked) {
      const gone = await tx
        .delete(pings)
        .where(
          and(eq(pings.deviceId, device.id), gte(pings.capturedAt, from), lt(pings.capturedAt, to)),
        )
        .returning({ seq: pings.seq });
      deletedPings += gone.length;
      if (from < now) {
        await tx.insert(erasures).values({
          id: crypto.randomUUID(),
          deviceId: device.id,
          from,
          to: to < now ? to : now,
        });
      }

      // The log rebuilds everything from its seam at or before `from`; with
      // none that early, from its earliest seam — and what came before that
      // seam has only the rows themselves to delete.
      const seam = await findSeam(tx, device, from);
      const coveredFrom = seam && seam.at < to ? (seam.at > from ? seam.at : from) : to;
      if (from < coveredFrom) {
        await unrollActivities(tx, device.id, from, coveredFrom);
        // Their focus segments cascade.
        await tx
          .delete(activities)
          .where(
            and(
              eq(activities.deviceId, device.id),
              gte(activities.startedAt, from),
              lt(activities.startedAt, coveredFrom),
            ),
          );
      }
      if (coveredFrom < to) await replayDevice(tx, device.id, { from });

      if (whole.length > 0) {
        await tx.delete(summaries).where(
          and(
            eq(summaries.deviceId, device.id),
            inArray(
              summaries.day,
              whole.map((day) => day.day),
            ),
          ),
        );
      }
      await dropEmptySummaries(tx, device.id);

      // A partly-covered day in the uncovered stretch still holds seconds of
      // its own when its summaries add up to more than the activities still on
      // file for it: pruned or imported time, which may or may not have been
      // inside the range.
      const unsplit = partial.filter(
        (day) => day.start < coveredFrom.getTime() && day.end > from.getTime(),
      );
      if (unsplit.length > 0) {
        const held = await heldSeconds(
          tx,
          device.id,
          unsplit.map((day) => day.day),
        );
        for (const [day, excess] of held) if (excess > 1e-3) partialDays.add(day);
      }
    }
    return {
      devices: locked.length,
      pings: deletedPings,
      days: whole.length,
      partialDays: [...partialDays].sort(),
    };
  });
}

interface CalendarDay {
  day: string;
  /** Its midnight and the next, epoch milliseconds. */
  start: number;
  end: number;
}

/**
 * The calendar days in `zone` that [from, to) touches, with their bounds.
 * Computed in SQL, where every other day in the system is (rollup.ts dayOf),
 * so a DST day is as long here as it is there.
 */
async function daysTouching(tx: Db, zone: string, from: Date, to: Date): Promise<CalendarDay[]> {
  const series = sql`generate_series(
    date_trunc('day', ${from.toISOString()}::timestamptz at time zone ${zone}),
    (${to.toISOString()}::timestamptz - interval '1 microsecond') at time zone ${zone},
    interval '1 day'
  ) as d(local)`;
  const epochMs = (local: string) =>
    sql<number>`extract(epoch from (${sql.raw(local)} at time zone ${zone})) * 1000`.mapWith(
      Number,
    );
  return tx
    .select({
      day: sql<string>`to_char(local, 'YYYY-MM-DD')`,
      start: epochMs('local'),
      end: epochMs(`(local + interval '1 day')`),
    })
    .from(series)
    .orderBy(sql`local`);
}

/**
 * Per day, how many more seconds the device's summaries hold than its
 * remaining rolled activities account for — the part of the day nothing but
 * the summary row remembers.
 */
async function heldSeconds(tx: Db, deviceId: string, days: string[]): Promise<Map<string, number>> {
  const summed = await tx
    .select({ day: summaries.day, seconds: sql<number>`sum(${summaries.seconds})`.mapWith(Number) })
    .from(summaries)
    .where(and(eq(summaries.deviceId, deviceId), inArray(summaries.day, days)))
    .groupBy(summaries.day);
  const rolled = await tx
    .select({
      day: dayOf,
      seconds: sql<number>`sum(${activities.activeSeconds})`.mapWith(Number),
    })
    .from(activities)
    .innerJoin(devices, ownerJoin.device)
    .innerJoin(user, ownerJoin.user)
    .where(
      and(
        eq(activities.deviceId, deviceId),
        eq(activities.rolledUp, true),
        sql`${dayOf} in (${sql.join(
          days.map((day) => sql`${day}`),
          sql`, `,
        )})`,
      ),
    )
    .groupBy(dayOf);
  const byDay = new Map(rolled.map((row) => [row.day, row.seconds]));
  return new Map(summed.map((row) => [row.day, row.seconds - (byDay.get(row.day) ?? 0)]));
}

export interface AppPurge {
  pings: number;
  activities: number;
  summaries: number;
}

/**
 * Deletes every trace of an entry — an app, or with `context` one context of
 * it — from all of the user's devices: the raw pings that fold into it, its
 * activities (and their focus segments), and its summary rows, pruned and
 * imported days included, since a summary row is keyed by the entry itself.
 *
 * Matched the way the dashboard shows it: a raw ping is the entry's if it
 * resolves to it under the current context and merge rules (ingest.ts
 * resolvePing), so purging a merged name takes the names merged into it too.
 *
 * Nothing is replayed. The derived rows of every other entry stand as they
 * were folded, and that is the right answer for all but the edges: a later
 * replay over the gaps the deleted pings leave credits each gap's first
 * ACCRUE_CAP_SECONDS or less to whatever was focused before it.
 *
 * It removes history, not the habit: pings recorded after this are new, and
 * the agents' ignoreApps is what stops an app being recorded at all.
 */
export async function purgeApp(
  db: Db,
  userId: string,
  entry: { app: string; context: string | null },
): Promise<AppPurge> {
  const app = entry.app.trim();
  if (!app) throw badInput('Name the app to delete');
  const context = entry.context?.trim() || null;
  // Before the locks, as ingestion loads them: rules don't change what the
  // locks protect.
  const rules = await loadFoldRules(db, userId);
  // Only a ping reported under one of these can resolve to the app: its own
  // name, or a name some merge rule renames.
  const candidates = [...new Set([app, ...rules.merge.map((rule) => rule.fromApp)])];
  const matches = (ping: { app: string | null; context?: string | null }) =>
    ping.app === app && (context === null || (ping.context ?? null) === context);

  return db.transaction(async (tx) => {
    const locked = await lockDevices(tx, userId);
    const now = new Date();
    let deletedPings = 0;
    for (const device of locked) {
      let after: { capturedAt: Date; seq: number } | null = null;
      const doomed: { capturedAt: Date; seq: number }[] = [];
      for (;;) {
        const page = await tx
          .select()
          .from(pings)
          .where(
            and(
              eq(pings.deviceId, device.id),
              inArray(pings.app, candidates),
              after
                ? sql`(${pings.capturedAt}, ${pings.seq}) > (${after.capturedAt.toISOString()}::timestamptz, ${after.seq})`
                : undefined,
            ),
          )
          .orderBy(asc(pings.capturedAt), asc(pings.seq))
          .limit(DELETE_CHUNK);
        for (const ping of page) {
          if (matches(resolvePing(rules, ping))) doomed.push(ping);
        }
        if (page.length < DELETE_CHUNK) break;
        after = page.at(-1)!;
      }
      for (let i = 0; i < doomed.length; i += DELETE_CHUNK) {
        const chunk = doomed.slice(i, i + DELETE_CHUNK);
        const gone = await tx
          .delete(pings)
          .where(
            and(
              eq(pings.deviceId, device.id),
              // The range lets the primary key narrow the scan; seq alone is unique.
              gte(pings.capturedAt, chunk[0]!.capturedAt),
              lte(pings.capturedAt, chunk.at(-1)!.capturedAt),
              inArray(
                pings.seq,
                chunk.map((ping) => ping.seq),
              ),
            ),
          )
          .returning({ seq: pings.seq });
        deletedPings += gone.length;
      }
      await tx.insert(erasures).values({
        id: crypto.randomUUID(),
        deviceId: device.id,
        from: null,
        to: now,
        app,
        context,
      });
    }

    const ids = locked.map((device) => device.id);
    if (ids.length === 0) return { pings: 0, activities: 0, summaries: 0 };
    const entryOf = (table: typeof activities | typeof summaries): ReturnType<typeof and> =>
      and(
        inArray(table.deviceId, ids),
        eq(table.app, app),
        context === null ? undefined : eq(table.context, context),
      );
    // Open rows too: fold opens a fresh one on the app's next ping.
    const deletedActivities = await tx
      .delete(activities)
      .where(entryOf(activities))
      .returning({ id: activities.id });
    const deletedSummaries = await tx
      .delete(summaries)
      .where(entryOf(summaries))
      .returning({ id: summaries.id });
    return {
      pings: deletedPings,
      activities: deletedActivities.length,
      summaries: deletedSummaries.length,
    };
  });
}

/**
 * Deletes the user and everything they own, once `email` — retyped by the
 * person asking — matches the account's. Returns false when there is no such
 * user any more.
 *
 * Deleting the user row cascades to everything else that is theirs: sessions,
 * sign-in accounts, API keys (only hashes are stored, so the rows going is a
 * full revocation, and every agent's next upload is refused), devices and
 * through them pings, erasures, activities, focus segments and summaries, and
 * categories and every kind of rule. Two things don't hang off the user row
 * and go explicitly: the keys, first, so no request authenticated by one can
 * start between here and the cascade; and any magic link still outstanding
 * for the address, which would otherwise sign a new account straight back in.
 *
 * Under the device locks, so no upload or replay is part-way through a device
 * as it goes.
 */
export async function deleteAccount(db: Db, userId: string, email: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    await lockDevices(tx, userId);
    const [current] = await tx.select({ email: user.email }).from(user).where(eq(user.id, userId));
    if (!current) return false;
    const normalize = (address: string) => address.trim().toLowerCase();
    if (normalize(email) !== normalize(current.email)) {
      throw badInput('Type the email address of this account to delete it');
    }

    await tx.delete(apikey).where(eq(apikey.referenceId, userId));
    // A magic link's value is JSON naming the address it signs in; the LIKE
    // only narrows the rows the parse has to check.
    const links = await tx
      .select({ id: verification.id, value: verification.value })
      .from(verification)
      .where(like(sql`lower(${verification.value})`, `%${escapeLike(normalize(current.email))}%`));
    const stale = links.filter((link) => {
      try {
        const parsed = JSON.parse(link.value) as { email?: unknown };
        return (
          typeof parsed.email === 'string' && normalize(parsed.email) === normalize(current.email)
        );
      } catch {
        return false;
      }
    });
    if (stale.length > 0) {
      await tx.delete(verification).where(
        inArray(
          verification.id,
          stale.map((link) => link.id),
        ),
      );
    }
    await tx.delete(user).where(eq(user.id, userId));
    return true;
  });
}

const escapeLike = (text: string) => text.replace(/[\\%_]/g, (char) => `\\${char}`);

/**
 * Sets (or, with null, clears) how many days of raw pings and activities the
 * user keeps, which can only be fewer than the server's `serverDays` (0 keeps
 * everything, so any number of days is fewer). Takes effect at the next prune
 * (rollup.ts startRollupTimer) rather than here: pruning holds each device's
 * lock in turn, and a setting has no reason to wait for all of them.
 */
export async function setUserRetention(
  db: Db,
  userId: string,
  days: number | null,
  serverDays: number,
): Promise<void> {
  if (days !== null) {
    if (!Number.isInteger(days) || days < 1) {
      throw badInput('Keep raw history for at least one day');
    }
    if (serverDays > 0 && days > serverDays) {
      throw badInput(`This server keeps raw history for ${serverDays} days; choose that or fewer`);
    }
  }
  await db.update(user).set({ retentionDays: days }).where(eq(user.id, userId));
}

export interface UserRetention {
  /** What the user chose, or null to follow the server. */
  retentionDays: number | null;
  /** Days of raw history actually kept: the shorter of theirs and the server's, null for forever. */
  effectiveRetentionDays: number | null;
}

export async function loadUserRetention(
  db: Db,
  userId: string,
  serverDays: number,
): Promise<UserRetention | undefined> {
  const [row] = await db
    .select({ retentionDays: user.retentionDays })
    .from(user)
    .where(eq(user.id, userId));
  if (!row) return undefined;
  const server = serverDays > 0 ? serverDays : null;
  const effective =
    row.retentionDays === null || server === null
      ? (row.retentionDays ?? server)
      : Math.min(row.retentionDays, server);
  return { retentionDays: row.retentionDays, effectiveRetentionDays: effective };
}
