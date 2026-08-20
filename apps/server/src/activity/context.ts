import { asc, eq } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { contextRules } from '../db/schema.ts';

// Context extraction: pulls the sub-app "context" — the open book, Ableton
// project, IDE workspace — out of a ping's window title via the user's
// priority-ordered rules. Runs server-side at fold time, BEFORE the activity
// row is matched, because context is part of the row's identity: unlike
// category rules it cannot be re-applied retroactively (churned titles are
// gone), so rules only shape rows going forward.

export type ContextRule = typeof contextRules.$inferSelect;

/** Compiles leniently — rows predating a validation change must not poison ingestion. */
function compile(pattern: string): RegExp | null {
  try {
    return new RegExp(pattern, 'i');
  } catch {
    return null;
  }
}

/**
 * Throws unless the pattern is a valid regex containing at least one capture
 * group — capture group 1 is what extraction returns. Used at rule creation.
 */
export function assertValidContextPattern(pattern: string): void {
  let compiled: RegExp;
  try {
    compiled = new RegExp(`${pattern}|`, 'i');
  } catch {
    throw new Error(`Invalid pattern: ${pattern}`);
  }
  // The alternation with '' always matches; the exec result's length counts
  // the pattern's capture groups without needing matching input.
  if ((compiled.exec('')?.length ?? 1) < 2) {
    throw new Error(`Pattern needs a capture group for the context: ${pattern}`);
  }
}

/** The user's context rules in evaluation order. */
export function loadContextRules(db: Db, userId: string): Promise<ContextRule[]> {
  return db
    .select()
    .from(contextRules)
    .where(eq(contextRules.userId, userId))
    .orderBy(asc(contextRules.priority), asc(contextRules.createdAt));
}

/**
 * First rule (by priority, then age) whose appPattern (if any) matches the app
 * and whose titlePattern captures something non-empty in the title wins; its
 * trimmed capture group 1 is the context. Null when nothing matches, the ping
 * has no title, or the capture is empty — the activity then folds by app alone.
 */
export function extractContext(
  rules: ContextRule[],
  app: string | null,
  title: string | null,
): string | null {
  if (title === null) return null;
  for (const rule of rules) {
    if (rule.appPattern && (app === null || !compile(rule.appPattern)?.test(app))) continue;
    const captured = compile(rule.titlePattern)?.exec(title)?.[1]?.trim();
    if (captured) return captured;
  }
  return null;
}
