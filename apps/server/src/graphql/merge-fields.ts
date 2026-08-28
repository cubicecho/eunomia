import type { MutationResolvers } from '@eunomia/gql/resolvers';
import { and, eq } from 'drizzle-orm';
import {
  type Entry,
  loadMergeRules,
  mergeEntry,
  sameEntry,
  sweepMergeRules,
} from '../activity/merge-rules.ts';
import type { Db } from '../db/client.ts';
import { mergeRules } from '../db/schema.ts';
import { badInput, notFound } from '../errors.ts';
import { requireUser } from './guards.ts';

// Merging two entries — two names for one app, or two contexts inside one —
// into a single line of history. The third and last thing the dashboard can do
// to a recording after the fact: categories label time, context rules divide
// it, and this renames it. See src/activity/merge-rules.ts for the semantics.

/** Trims, and reads an empty string as "no context" — a blank field is not a name. */
function readEntry(app: string, context: string | null | undefined): Entry {
  const name = app.trim();
  if (!name) throw badInput('A merge needs an app name on both sides');
  const within = context?.trim();
  return { app: name, context: within ? within : null };
}

export function mergeFields(db: Db) {
  return {
    // Creates the rule and immediately applies it to everything already
    // recorded — "merge these two" means the chart changes now, not once
    // enough new pings have arrived to outweigh the old ones.
    createMergeRule: async (_source, args, ctx) => {
      const userId = requireUser(ctx);
      const from = readEntry(args.fromApp, args.fromContext);
      const to = readEntry(args.toApp, args.toContext);
      if (from.context === null && to.context !== null) {
        throw badInput(
          'Merging a whole app keeps each entry’s context — name the context to merge as well',
        );
      }
      if (sameEntry(from, to)) throw badInput('That entry is already what you are merging into');

      const existing = await loadMergeRules(db, userId);
      if (
        existing.some((rule) => sameEntry({ app: rule.fromApp, context: rule.fromContext }, from))
      ) {
        throw badInput('That entry is already merged into something else');
      }
      // Where the target itself ends up. If following the existing rules
      // from there leads back to the source, the pair is a loop and the
      // merge has no answer — refuse rather than resolve it arbitrarily.
      if (sameEntry(mergeEntry(existing, to), from)) {
        throw badInput('That would merge the two entries into each other');
      }

      const [row] = await db
        .insert(mergeRules)
        .values({
          id: crypto.randomUUID(),
          userId,
          fromApp: from.app,
          fromContext: from.context,
          toApp: to.app,
          toContext: to.context,
        })
        .returning();
      await sweepMergeRules(db, userId);
      return row!;
    },
    // Stops the merge from applying to new pings. History already rewritten
    // stays rewritten — the old and new names were folded into one row and
    // nothing records which seconds came from which, so this is a forward
    // switch, not an undo. Same shape as deleting a category rule.
    deleteMergeRule: async (_source, args, ctx) => {
      const userId = requireUser(ctx);
      const deleted = await db
        .delete(mergeRules)
        .where(and(eq(mergeRules.id, args.id), eq(mergeRules.userId, userId)))
        .returning({ id: mergeRules.id });
      if (deleted.length === 0) throw notFound('Unknown merge');
      return true;
    },
    // Re-runs every merge over past activity; returns how many activities
    // changed. Creating a merge already does this, so it is here for the case
    // creation can't cover: history that arrived afterwards, from a device
    // that was offline or an agent still reporting the old name.
    applyMergeRules: (_source, _args, ctx) => sweepMergeRules(db, requireUser(ctx)),
  } satisfies MutationResolvers;
}
