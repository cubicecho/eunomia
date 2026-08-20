import { and, asc, eq, isNull, ne, or } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { activities, categoryRules, devices } from '../db/schema.ts';
import type { Activity } from './fold.ts';
import { moveRolledSeconds } from './rollup.ts';

export type CategoryRule = typeof categoryRules.$inferSelect;

/**
 * Compiles a rule pattern. Invalid regexes are treated as never-matching
 * rather than throwing mid-ping (creation validates, but rows predating a
 * validation change shouldn't poison ingestion).
 */
function compile(pattern: string): RegExp | null {
  try {
    return new RegExp(pattern, 'i');
  } catch {
    return null;
  }
}

/** Throws if the pattern isn't a valid regex — used at rule creation. */
export function assertValidPattern(pattern: string): void {
  try {
    new RegExp(pattern, 'i');
  } catch {
    throw new Error(`Invalid pattern: ${pattern}`);
  }
}

/**
 * First rule (by priority, then age) matching the activity's app/title/context,
 * or null. Every pattern a rule carries must match; a title or context pattern
 * never matches an activity missing that field.
 */
export function matchRule(
  rules: CategoryRule[],
  app: string,
  title: string | null,
  context: string | null = null,
): CategoryRule | null {
  for (const rule of rules) {
    if (!rule.appPattern && !rule.titlePattern && !rule.contextPattern) continue;
    if (rule.appPattern && !compile(rule.appPattern)?.test(app)) continue;
    if (rule.titlePattern && (title === null || !compile(rule.titlePattern)?.test(title))) {
      continue;
    }
    if (rule.contextPattern && (context === null || !compile(rule.contextPattern)?.test(context))) {
      continue;
    }
    return rule;
  }
  return null;
}

/** The user's rules in evaluation order. */
export function loadRules(db: Db, userId: string): Promise<CategoryRule[]> {
  return db
    .select()
    .from(categoryRules)
    .where(eq(categoryRules.userId, userId))
    .orderBy(asc(categoryRules.priority), asc(categoryRules.createdAt));
}

/**
 * Re-evaluates one activity against the user's rules — called after every
 * fold, so title churn, new rules, and deleted rules all converge lazily.
 * Manual assignments are never touched. No match clears a previous
 * rule-sourced assignment. Returns the (possibly updated) activity.
 */
export async function applyRules(
  db: Db,
  rules: CategoryRule[],
  activity: Activity,
): Promise<Activity> {
  if (activity.categorySource === 'manual') return activity;
  const matched = matchRule(rules, activity.app, activity.title, activity.context);
  const categoryId = matched?.categoryId ?? null;
  if (categoryId === activity.categoryId) return activity;
  const [updated] = await db
    .update(activities)
    .set({ categoryId, categorySource: matched ? 'rule' : null })
    .where(eq(activities.id, activity.id))
    .returning();
  // Already-summarized activities carry their seconds along (no-op when
  // un-rolled, i.e. for every open activity the ping path re-evaluates).
  await moveRolledSeconds(db, activity, activity.categoryId, categoryId);
  return updated!;
}

/**
 * Applies the user's rules to every non-manually-assigned activity they own —
 * the retroactive path for rows that predate a rule (open or closed; pings
 * only re-evaluate rows they touch). Returns how many changed.
 */
export async function sweepRules(db: Db, userId: string): Promise<number> {
  const rules = await loadRules(db, userId);
  const rows = await db
    .select({ activity: activities })
    .from(activities)
    .innerJoin(devices, eq(activities.deviceId, devices.id))
    .where(
      and(
        eq(devices.userId, userId),
        or(isNull(activities.categorySource), ne(activities.categorySource, 'manual')),
      ),
    );
  let changed = 0;
  for (const { activity } of rows) {
    const updated = await applyRules(db, rules, activity);
    if (updated.categoryId !== activity.categoryId) changed += 1;
  }
  return changed;
}
