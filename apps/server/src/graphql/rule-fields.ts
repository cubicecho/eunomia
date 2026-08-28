import { eq } from 'drizzle-orm';
import { assertValidContextPattern } from '../activity/context.ts';
import { assertValidPattern, sweepRules } from '../activity/rules.ts';
import type { Db } from '../db/client.ts';
import { categories, categoryRules, contextRules } from '../db/schema.ts';
import { badInput } from '../errors.ts';
import type {
  MutationCreateCategoryRuleArgs,
  MutationCreateContextRuleArgs,
  MutationResolvers,
} from '../gql/resolvers.ts';
import { requireOwned, requireUser } from './guards.ts';

// The two rule kinds. Category rules assign activities to a bucket and can be
// swept retroactively; context rules split time WITHIN an app and apply only
// to rows folded from now on, because the titles they read are already gone.

// Both rule kinds are written by two fields apiece (create and update), and
// update is the create arguments plus an id — so the helpers below take the
// create arguments, which an update's satisfy.
type CategoryRuleArgs = MutationCreateCategoryRuleArgs;
type ContextRuleArgs = MutationCreateContextRuleArgs;

/**
 * A category rule has to match on something, and every pattern it does carry
 * has to be a regex the sweep can compile.
 */
function assertUsableCategoryRule(args: CategoryRuleArgs): void {
  if (args.appPattern == null && args.titlePattern == null && args.contextPattern == null) {
    throw badInput('A rule needs an appPattern, titlePattern, and/or contextPattern');
  }
  for (const pattern of [args.appPattern, args.titlePattern, args.contextPattern]) {
    if (pattern != null) assertValidPattern(pattern);
  }
}

/** The written columns, shared by create and update (both take a whole rule). */
const categoryRuleValues = (args: CategoryRuleArgs) => ({
  categoryId: args.categoryId,
  appPattern: args.appPattern ?? null,
  titlePattern: args.titlePattern ?? null,
  contextPattern: args.contextPattern ?? null,
  priority: args.priority ?? 0,
});

function assertUsableContextRule(args: ContextRuleArgs): void {
  if (args.appPattern != null) assertValidPattern(args.appPattern);
  assertValidContextPattern(args.titlePattern);
}

const contextRuleValues = (args: ContextRuleArgs) => ({
  appPattern: args.appPattern ?? null,
  titlePattern: args.titlePattern,
  priority: args.priority ?? 0,
});

export function ruleFields(db: Db) {
  return {
    createCategoryRule: async (_source, args, ctx) => {
      const userId = requireUser(ctx);
      assertUsableCategoryRule(args);
      await requireOwned(db, categories, args.categoryId, userId, 'Unknown category');
      const [row] = await db
        .insert(categoryRules)
        .values({ id: crypto.randomUUID(), userId, ...categoryRuleValues(args) })
        .returning();
      return row!;
    },
    // A full replacement, not a patch: the editor always submits the whole
    // rule, and a null pattern there means "this rule no longer matches on
    // that field" — which a patch couldn't express.
    updateCategoryRule: async (_source, args, ctx) => {
      const userId = requireUser(ctx);
      assertUsableCategoryRule(args);
      const rule = await requireOwned(db, categoryRules, args.id, userId, 'Unknown rule');
      await requireOwned(db, categories, args.categoryId, userId, 'Unknown category');
      // Activities this rule already categorized keep their category until
      // the rules are applied again — same as deleting it would.
      const [row] = await db
        .update(categoryRules)
        .set(categoryRuleValues(args))
        .where(eq(categoryRules.id, rule.id))
        .returning();
      return row!;
    },
    // Existing rule-made assignments are cleared lazily (next ping or sweep),
    // not here.
    deleteCategoryRule: async (_source, args, ctx) => {
      const userId = requireUser(ctx);
      const rule = await requireOwned(db, categoryRules, args.id, userId, 'Unknown rule');
      await db.delete(categoryRules).where(eq(categoryRules.id, rule.id));
      return true;
    },
    // Retroactive sweep over every activity the caller owns (manual
    // assignments excluded). Returns how many activities changed.
    applyCategoryRules: (_source, _args, ctx) => sweepRules(db, requireUser(ctx)),
    // Context rules split time WITHIN an app (per book, per project, per site)
    // by extracting the title pattern's first capture group at fold time.
    // Identity-shaping: applies to rows created from now on only — churned
    // titles are gone, so there is no retroactive sweep.
    createContextRule: async (_source, args, ctx) => {
      const userId = requireUser(ctx);
      assertUsableContextRule(args);
      const [row] = await db
        .insert(contextRules)
        .values({ id: crypto.randomUUID(), userId, ...contextRuleValues(args) })
        .returning();
      return row!;
    },
    // Identity-shaping like createContextRule: rows already folded keep the
    // context the old pattern gave them, and the new one takes over from the
    // next fold on.
    updateContextRule: async (_source, args, ctx) => {
      const userId = requireUser(ctx);
      assertUsableContextRule(args);
      const rule = await requireOwned(db, contextRules, args.id, userId, 'Unknown rule');
      const [row] = await db
        .update(contextRules)
        .set(contextRuleValues(args))
        .where(eq(contextRules.id, rule.id))
        .returning();
      return row!;
    },
    // Existing rows keep the context they were created with; only future folds
    // stop extracting.
    deleteContextRule: async (_source, args, ctx) => {
      const userId = requireUser(ctx);
      const rule = await requireOwned(db, contextRules, args.id, userId, 'Unknown rule');
      await db.delete(contextRules).where(eq(contextRules.id, rule.id));
      return true;
    },
  } satisfies MutationResolvers;
}
