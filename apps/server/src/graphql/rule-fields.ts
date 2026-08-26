import { eq } from 'drizzle-orm';
import { GraphQLBoolean, GraphQLInt, GraphQLNonNull, GraphQLString } from 'graphql';
import { assertValidContextPattern } from '../activity/context.ts';
import { assertValidPattern, sweepRules } from '../activity/rules.ts';
import type { Db } from '../db/client.ts';
import { categories, categoryRules, contextRules } from '../db/schema.ts';
import { badInput } from '../errors.ts';
import type { Context } from './context.ts';
import type { Entities, Fields } from './entities.ts';
import { requireOwned, requireUser } from './guards.ts';

// The two rule kinds. Category rules assign activities to a bucket and can be
// swept retroactively; context rules split time WITHIN an app and apply only
// to rows folded from now on, because the titles they read are already gone.

interface CategoryRuleArgs {
  categoryId: string;
  appPattern?: string | null;
  titlePattern?: string | null;
  contextPattern?: string | null;
  priority?: number | null;
}

const categoryRuleArgs = {
  categoryId: { type: new GraphQLNonNull(GraphQLString) },
  appPattern: { type: GraphQLString },
  titlePattern: { type: GraphQLString },
  contextPattern: { type: GraphQLString },
  priority: { type: GraphQLInt },
};

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

interface ContextRuleArgs {
  appPattern?: string | null;
  titlePattern: string;
  priority?: number | null;
}

const contextRuleArgs = {
  appPattern: { type: GraphQLString },
  titlePattern: { type: new GraphQLNonNull(GraphQLString) },
  priority: { type: GraphQLInt },
};

function assertUsableContextRule(args: ContextRuleArgs): void {
  if (args.appPattern != null) assertValidPattern(args.appPattern);
  assertValidContextPattern(args.titlePattern);
}

const contextRuleValues = (args: ContextRuleArgs) => ({
  appPattern: args.appPattern ?? null,
  titlePattern: args.titlePattern,
  priority: args.priority ?? 0,
});

export function ruleFields(db: Db, entities: Entities) {
  return {
    createCategoryRule: {
      type: new GraphQLNonNull(entities.types.CategoryRules!),
      args: categoryRuleArgs,
      resolve: async (_source, args: CategoryRuleArgs, ctx: Context) => {
        const userId = requireUser(ctx);
        assertUsableCategoryRule(args);
        await requireOwned(db, categories, args.categoryId, userId, 'Unknown category');
        const [row] = await db
          .insert(categoryRules)
          .values({ id: crypto.randomUUID(), userId, ...categoryRuleValues(args) })
          .returning();
        return row;
      },
    },
    updateCategoryRule: {
      // A full replacement, not a patch: the editor always submits the whole
      // rule, and a null pattern there means "this rule no longer matches on
      // that field" — which a patch couldn't express.
      type: new GraphQLNonNull(entities.types.CategoryRules!),
      args: { id: { type: new GraphQLNonNull(GraphQLString) }, ...categoryRuleArgs },
      resolve: async (_source, args: CategoryRuleArgs & { id: string }, ctx: Context) => {
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
        return row;
      },
    },
    deleteCategoryRule: {
      // Existing rule-made assignments are cleared lazily (next ping or
      // sweep), not here.
      type: new GraphQLNonNull(GraphQLBoolean),
      args: {
        id: { type: new GraphQLNonNull(GraphQLString) },
      },
      resolve: async (_source, args: { id: string }, ctx: Context) => {
        const userId = requireUser(ctx);
        const rule = await requireOwned(db, categoryRules, args.id, userId, 'Unknown rule');
        await db.delete(categoryRules).where(eq(categoryRules.id, rule.id));
        return true;
      },
    },
    applyCategoryRules: {
      // Retroactive sweep over every activity the caller owns (manual
      // assignments excluded). Returns how many activities changed.
      type: new GraphQLNonNull(GraphQLInt),
      resolve: (_source, _args, ctx: Context) => sweepRules(db, requireUser(ctx)),
    },
    createContextRule: {
      // Context rules split time WITHIN an app (per book, per project, per
      // site) by extracting the title pattern's first capture group at fold
      // time. Identity-shaping: applies to rows created from now on only —
      // churned titles are gone, so there is no retroactive sweep.
      type: new GraphQLNonNull(entities.types.ContextRules!),
      args: contextRuleArgs,
      resolve: async (_source, args: ContextRuleArgs, ctx: Context) => {
        const userId = requireUser(ctx);
        assertUsableContextRule(args);
        const [row] = await db
          .insert(contextRules)
          .values({ id: crypto.randomUUID(), userId, ...contextRuleValues(args) })
          .returning();
        return row;
      },
    },
    updateContextRule: {
      // Identity-shaping like createContextRule: rows already folded keep the
      // context the old pattern gave them, and the new one takes over from the
      // next fold on.
      type: new GraphQLNonNull(entities.types.ContextRules!),
      args: { id: { type: new GraphQLNonNull(GraphQLString) }, ...contextRuleArgs },
      resolve: async (_source, args: ContextRuleArgs & { id: string }, ctx: Context) => {
        const userId = requireUser(ctx);
        assertUsableContextRule(args);
        const rule = await requireOwned(db, contextRules, args.id, userId, 'Unknown rule');
        const [row] = await db
          .update(contextRules)
          .set(contextRuleValues(args))
          .where(eq(contextRules.id, rule.id))
          .returning();
        return row;
      },
    },
    deleteContextRule: {
      // Existing rows keep the context they were created with; only future
      // folds stop extracting.
      type: new GraphQLNonNull(GraphQLBoolean),
      args: {
        id: { type: new GraphQLNonNull(GraphQLString) },
      },
      resolve: async (_source, args: { id: string }, ctx: Context) => {
        const userId = requireUser(ctx);
        const rule = await requireOwned(db, contextRules, args.id, userId, 'Unknown rule');
        await db.delete(contextRules).where(eq(contextRules.id, rule.id));
        return true;
      },
    },
  } satisfies Fields;
}
