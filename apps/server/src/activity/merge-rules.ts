import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import type { Db } from '../db/client.ts';
import { activities, devices, mergeRules, summaries } from '../db/schema.ts';
import { addSeconds } from './rollup.ts';

// Identity merging: folding two names for the same thing into one.
//
// The dashboard's unit of time is an ENTRY — an (app, context) pair, the key
// fold.ts groups activities by and the key summaries are rolled up under. The
// same real thing acquires two entries whenever the name it is reported under
// changes: a phone that reported "com.instagram.android" until its agent
// learned to ask Android for "Instagram", a browser site whose context rule was
// rewritten, an app renamed between agent versions. Nothing else in the system
// can put those back together — category rules label time, they don't rename
// it, and context rules only shape rows folded from now on.
//
// So a merge rule says "this entry IS that one", and it is applied twice: at
// fold time, so pings still arriving under the old name land under the new one,
// and over stored history, so the past reads the same way. Both halves matter.
// Without the first the user re-merges every week; without the second the
// dashboard keeps two bars for one thing forever.
//
// Not to be confused with merge.ts, which merges DEVICES.

export type MergeRule = typeof mergeRules.$inferSelect;

/** The dashboard's unit of time: an app, optionally divided by a context. */
export interface Entry {
  app: string;
  context: string | null;
}

/**
 * How far a chain of merges is followed. Chains happen honestly — merge A into
 * B today, B into C next month — and the cap is only here so a cycle (which
 * createMergeRule refuses, but stored data is stored data) can't spin.
 */
const MAX_HOPS = 8;

const keyOf = (entry: Entry): string => `${entry.app}\n${entry.context ?? '\0'}`;

export const sameEntry = (a: Entry, b: Entry): boolean =>
  a.app === b.app && a.context === b.context;

/**
 * The user's merge rules in the order they are matched: entry-specific rules
 * (fromContext set) before app-wide ones, then oldest first.
 *
 * Specificity has to come first or it never applies — an app-wide rename would
 * move the row out from under the rule that names one of its contexts. Age
 * breaks the remaining ties so the order is stable and reproducible, which is
 * what makes a sweep's outcome the same every time it runs.
 */
export function loadMergeRules(db: Db, userId: string): Promise<MergeRule[]> {
  return (
    db
      .select()
      .from(mergeRules)
      .where(eq(mergeRules.userId, userId))
      // false before true in Postgres, so "has a context" sorts first.
      .orderBy(sql`${mergeRules.fromContext} is null`, asc(mergeRules.createdAt))
  );
}

/** Whether `rule` claims `entry` as its source. */
function matches(rule: MergeRule, entry: Entry): boolean {
  if (rule.fromApp !== entry.app) return false;
  // A null fromContext is the app-wide rule: every context of that app.
  return rule.fromContext === null || rule.fromContext === entry.context;
}

/** Where `rule` sends `entry`. App-wide rules rename the app and keep the context. */
function destination(rule: MergeRule, entry: Entry): Entry {
  return {
    app: rule.toApp,
    context: rule.fromContext === null ? entry.context : rule.toContext,
  };
}

/**
 * The entry `entry` finally becomes under `rules` — following chains, and
 * stopping on a cycle at wherever it had got to rather than spinning.
 *
 * This is the single definition of what a merge means. Fold time calls it per
 * ping and the sweep calls it per distinct stored entry, which is what keeps
 * "what the dashboard will show tomorrow" and "what it shows for last month"
 * the same answer.
 */
export function mergeEntry(rules: MergeRule[], entry: Entry): Entry {
  let current = entry;
  const seen = new Set<string>([keyOf(entry)]);
  for (let hop = 0; hop < MAX_HOPS; hop++) {
    const rule = rules.find((candidate) => matches(candidate, current));
    if (!rule) break;
    const next = destination(rule, current);
    if (seen.has(keyOf(next))) break;
    seen.add(keyOf(next));
    current = next;
  }
  return current;
}

/** The rows of one exact entry, fenced to devices the user owns. */
function entryMatch(
  deviceColumn: AnyPgColumn,
  appColumn: AnyPgColumn,
  contextColumn: AnyPgColumn,
  ownDeviceIds: string[],
  entry: Entry,
) {
  return and(
    inArray(deviceColumn, ownDeviceIds),
    eq(appColumn, entry.app),
    entry.context === null ? isNull(contextColumn) : eq(contextColumn, entry.context),
  );
}

/**
 * Rewrites every stored trace of `from` to read as `to`: raw activities, and
 * the summary rows their seconds were already rolled into. Returns how many
 * activities moved.
 *
 * Two hazards, the same two mergeDeviceHistory has:
 *
 * - **Open activities.** foldPing expects at most one open row per (app,
 *   context) per device, and rewriting the key could hand it two. The matching
 *   open rows are closed at their lastActiveAt first — the next ping opens a
 *   fresh row under the merged name, which is the correct history anyway.
 * - **Summaries.** The rewritten key collides with the target's existing row
 *   under summaries_key_idx, so each row is added into the target's and
 *   dropped rather than updated in place.
 *
 * Summaries are rewritten wholesale rather than through moveRolledSeconds: a
 * summary row's (app, context) is exactly the set of activities that rolled
 * into it, so the whole row moves. That also fixes days whose raw activities
 * have already aged out under ACTIVITY_RETENTION_DAYS — there is no activity
 * left to walk, but the seconds are still on the chart.
 */
async function rewriteEntry(
  db: Db,
  ownDeviceIds: string[],
  from: Entry,
  to: Entry,
): Promise<number> {
  if (ownDeviceIds.length === 0 || sameEntry(from, to)) return 0;
  return db.transaction(async (tx) => {
    const match = entryMatch(
      activities.deviceId,
      activities.app,
      activities.context,
      ownDeviceIds,
      from,
    );
    await tx
      .update(activities)
      .set({ closedAt: sql`${activities.lastActiveAt}` })
      .where(and(match, isNull(activities.closedAt)));
    const moved = await tx
      .update(activities)
      .set({ app: to.app, context: to.context })
      .where(match)
      .returning({ id: activities.id });

    const rows = await tx
      .select()
      .from(summaries)
      .where(entryMatch(summaries.deviceId, summaries.app, summaries.context, ownDeviceIds, from));
    for (const row of rows) {
      await addSeconds(
        tx,
        {
          deviceId: row.deviceId,
          day: row.day,
          app: to.app,
          context: to.context,
          categoryId: row.categoryId,
        },
        row.seconds,
      );
      await tx.delete(summaries).where(eq(summaries.id, row.id));
    }
    return moved.length;
  });
}

/** Every (app, context) the user has recorded, live rows and rolled-up ones alike. */
async function storedEntries(db: Db, ownDeviceIds: string[]): Promise<Entry[]> {
  if (ownDeviceIds.length === 0) return [];
  const [live, rolled] = await Promise.all([
    db
      .selectDistinct({ app: activities.app, context: activities.context })
      .from(activities)
      .where(inArray(activities.deviceId, ownDeviceIds)),
    db
      .selectDistinct({ app: summaries.app, context: summaries.context })
      .from(summaries)
      .where(inArray(summaries.deviceId, ownDeviceIds)),
  ]);
  const unique = new Map<string, Entry>();
  for (const entry of [...live, ...rolled]) unique.set(keyOf(entry), entry);
  return [...unique.values()];
}

export async function ownDeviceIds(db: Db, userId: string): Promise<string[]> {
  const rows = await db.select({ id: devices.id }).from(devices).where(eq(devices.userId, userId));
  return rows.map((row) => row.id);
}

/**
 * Re-runs every merge rule over the user's whole history. Returns how many
 * activities were rewritten.
 *
 * Driven by the entries that exist rather than by the rules — resolving each
 * one through mergeEntry — so chains land in one pass and the result doesn't
 * depend on which order the rules are visited in. Rule-at-a-time would: an
 * app-wide rename applied before the rule naming one of that app's contexts
 * would leave the second rule with nothing to match.
 *
 * Runs on every rule change, which is what a user means by "merge these".
 */
export async function sweepMergeRules(db: Db, userId: string): Promise<number> {
  const [rules, deviceIds] = await Promise.all([
    loadMergeRules(db, userId),
    ownDeviceIds(db, userId),
  ]);
  if (rules.length === 0) return 0;
  let moved = 0;
  for (const entry of await storedEntries(db, deviceIds)) {
    const target = mergeEntry(rules, entry);
    if (!sameEntry(entry, target)) moved += await rewriteEntry(db, deviceIds, entry, target);
  }
  return moved;
}
