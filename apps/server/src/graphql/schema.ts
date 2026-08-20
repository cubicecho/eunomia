import { buildSchema as buildDrizzleSchema } from '@vantreeseba/drizzle-graphql';
import { applyPermissions } from '@vantreeseba/graphql-casl';
import { and, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import {
  GraphQLBoolean,
  type GraphQLFieldConfig,
  GraphQLFloat,
  type GraphQLInputObjectType,
  GraphQLInt,
  GraphQLList,
  GraphQLNonNull,
  GraphQLObjectType,
  GraphQLSchema,
  GraphQLString,
} from 'graphql';
import {
  assertValidContextPattern,
  extractContext,
  loadContextRules,
} from '../activity/context.ts';
import { foldPing } from '../activity/fold.ts';
import { applyRules, assertValidPattern, loadRules, sweepRules } from '../activity/rules.ts';
import type { AuthGateway } from '../auth.ts';
import type { Db } from '../db/client.ts';
import { activities, categories, categoryRules, contextRules, devices } from '../db/schema.ts';
import type { Context } from './context.ts';
import { permissions } from './permissions.ts';
import { scopedListField } from './scoped.ts';

/**
 * Assembles the executable schema: selected drizzle-graphql entities plus
 * custom domain resolvers, with CASL permissions applied over the whole thing.
 *
 * The generated CRUD for auth tables and raw device mutations are deliberately
 * NOT exposed — only what's picked here exists in the public schema. Auth is
 * GraphQL too (signUp/signIn/signOut via the injected gateway): the server
 * mounts no better-auth REST routes.
 */
export function createSchema(db: Db, auth: AuthGateway) {
  // drizzle v1 RC types the db by its relations config, not its tables, so
  // drizzle-graphql's entity keys can't be inferred statically — widen to
  // string-keyed records (keys: queries.devices, types.Devices, ...).
  const entities = buildDrizzleSchema(db).entities as unknown as {
    queries: Record<string, GraphQLFieldConfig<unknown, Context>>;
    mutations: Record<string, GraphQLFieldConfig<unknown, Context>>;
    types: Record<string, GraphQLObjectType>;
    inputs: Record<string, GraphQLInputObjectType>;
  };

  // Every list query is fenced to the caller's rows in SQL — the generated
  // resolvers themselves return whatever the filter args ask for. Activities
  // carry no userId; ownership runs through the owning device.
  const ownDeviceIds = (ctx: Context) =>
    ctx.db.select({ id: devices.id }).from(devices).where(eq(devices.userId, ctx.userId!));

  // Dashboard aggregate row: active seconds per category per UTC day.
  const categoryDaySummaryType = new GraphQLObjectType({
    name: 'CategoryDaySummary',
    fields: {
      day: { type: new GraphQLNonNull(GraphQLString) },
      // Null category = uncategorized time.
      categoryId: { type: GraphQLString },
      name: { type: GraphQLString },
      color: { type: GraphQLString },
      seconds: { type: new GraphQLNonNull(GraphQLFloat) },
    },
  });

  const query = new GraphQLObjectType({
    name: 'Query',
    fields: {
      devices: scopedListField(entities.queries.devices!, devices, 'devices', (ctx) =>
        eq(devices.userId, ctx.userId),
      ),
      activities: scopedListField(entities.queries.activities!, activities, 'activities', (ctx) =>
        inArray(activities.deviceId, ownDeviceIds(ctx)),
      ),
      categories: scopedListField(entities.queries.categories!, categories, 'categories', (ctx) =>
        eq(categories.userId, ctx.userId),
      ),
      categoryRules: scopedListField(
        entities.queries.categoryRules!,
        categoryRules,
        'categoryRules',
        (ctx) => eq(categoryRules.userId, ctx.userId),
      ),
      contextRules: scopedListField(
        entities.queries.contextRules!,
        contextRules,
        'contextRules',
        (ctx) => eq(contextRules.userId, ctx.userId),
      ),
      categorySummary: {
        // Seconds of active time per category per day (UTC), for [from, to).
        // Each activity's whole activeSeconds lands on the day it started —
        // activities are short-lived (auto-closed after 15 min unfocused), so
        // midnight-spanning error is negligible for a dashboard.
        type: new GraphQLNonNull(new GraphQLList(new GraphQLNonNull(categoryDaySummaryType))),
        args: {
          from: { type: new GraphQLNonNull(GraphQLString) },
          to: { type: new GraphQLNonNull(GraphQLString) },
        },
        resolve: async (_source, args: { from: string; to: string }, ctx: Context) => {
          if (!ctx.userId) throw new Error('Not authenticated');
          const from = new Date(args.from);
          const to = new Date(args.to);
          if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
            throw new Error('Invalid date range');
          }
          const day = sql<string>`to_char(date_trunc('day', ${activities.startedAt}), 'YYYY-MM-DD')`;
          return db
            .select({
              day,
              categoryId: activities.categoryId,
              name: categories.name,
              color: categories.color,
              seconds: sql<number>`sum(${activities.activeSeconds})::float`,
            })
            .from(activities)
            .innerJoin(devices, eq(activities.deviceId, devices.id))
            .leftJoin(categories, eq(activities.categoryId, categories.id))
            .where(
              and(
                eq(devices.userId, ctx.userId),
                gte(activities.startedAt, from),
                lt(activities.startedAt, to),
              ),
            )
            .groupBy(day, activities.categoryId, categories.name, categories.color)
            .orderBy(day, activities.categoryId);
        },
      },
      me: {
        type: GraphQLString,
        resolve: (_source, _args, ctx: Context) => ctx.userId ?? null,
      },
    },
  });

  // Session payload for signUp/signIn: the raw session token goes back as
  // `Authorization: Bearer <token>` on every later request (bearer plugin).
  const authSessionType = new GraphQLObjectType({
    name: 'AuthSession',
    fields: {
      token: { type: new GraphQLNonNull(GraphQLString) },
      userId: { type: new GraphQLNonNull(GraphQLString) },
    },
  });

  const mutation = new GraphQLObjectType({
    name: 'Mutation',
    fields: {
      signUp: {
        type: new GraphQLNonNull(authSessionType),
        args: {
          email: { type: new GraphQLNonNull(GraphQLString) },
          password: { type: new GraphQLNonNull(GraphQLString) },
          name: { type: new GraphQLNonNull(GraphQLString) },
        },
        resolve: (_source, args: { email: string; password: string; name: string }) =>
          auth.signUp(args),
      },
      signIn: {
        type: new GraphQLNonNull(authSessionType),
        args: {
          email: { type: new GraphQLNonNull(GraphQLString) },
          password: { type: new GraphQLNonNull(GraphQLString) },
        },
        resolve: (_source, args: { email: string; password: string }) => auth.signIn(args),
      },
      requestMagicLink: {
        // Primary login: emails a single-use sign-in link (account created on
        // first use). `token` is populated only under UNSAFE_LOCAL_NETWORK,
        // letting clients on a trusted LAN sign in without an inbox.
        type: new GraphQLNonNull(
          new GraphQLObjectType({
            name: 'MagicLinkRequest',
            fields: {
              ok: { type: new GraphQLNonNull(GraphQLBoolean) },
              token: { type: GraphQLString },
            },
          }),
        ),
        args: {
          email: { type: new GraphQLNonNull(GraphQLString) },
        },
        resolve: async (_source, args: { email: string }) => {
          const { token } = await auth.requestMagicLink(args.email.toLowerCase().trim());
          return { ok: true, token };
        },
      },
      verifyMagicLink: {
        type: new GraphQLNonNull(authSessionType),
        args: {
          token: { type: new GraphQLNonNull(GraphQLString) },
        },
        resolve: (_source, args: { token: string }) => auth.verifyMagicLink(args.token),
      },
      signOut: {
        // True if a live session was revoked; false if the request had none.
        type: new GraphQLNonNull(GraphQLBoolean),
        resolve: (_source, _args, ctx: Context) => auth.signOut(ctx.headers),
      },
      registerDevice: {
        // Custom payload type: the plaintext API key exists only in this
        // response (the server stores a hash), so it rides along exactly once.
        type: new GraphQLNonNull(
          new GraphQLObjectType({
            name: 'DeviceRegistration',
            fields: {
              device: { type: new GraphQLNonNull(entities.types.Devices!) },
              apiKey: { type: new GraphQLNonNull(GraphQLString) },
            },
          }),
        ),
        args: {
          name: { type: new GraphQLNonNull(GraphQLString) },
          platform: { type: new GraphQLNonNull(GraphQLString) },
        },
        resolve: async (_source, args: { name: string; platform: string }, ctx: Context) => {
          if (!ctx.userId) throw new Error('Not authenticated');
          const [row] = await db
            .insert(devices)
            .values({
              id: crypto.randomUUID(),
              userId: ctx.userId,
              name: args.name,
              platform: args.platform as 'windows' | 'macos' | 'linux' | 'android',
            })
            .returning();
          const apiKey = await auth.mintDeviceKey({
            userId: ctx.userId,
            deviceId: row!.id,
            name: args.name,
          });
          return { device: row, apiKey };
        },
      },
      createCategory: {
        type: new GraphQLNonNull(entities.types.Categories!),
        args: {
          name: { type: new GraphQLNonNull(GraphQLString) },
          color: { type: GraphQLString },
        },
        resolve: async (_source, args: { name: string; color?: string | null }, ctx: Context) => {
          if (!ctx.userId) throw new Error('Not authenticated');
          const [row] = await db
            .insert(categories)
            .values({
              id: crypto.randomUUID(),
              userId: ctx.userId,
              name: args.name,
              color: args.color ?? null,
            })
            .returning();
          return row;
        },
      },
      deleteCategory: {
        // True when a category was deleted. Assigned activities are kept and
        // unassigned (FK set-null), never deleted with the bucket.
        type: new GraphQLNonNull(GraphQLBoolean),
        args: {
          id: { type: new GraphQLNonNull(GraphQLString) },
        },
        resolve: async (_source, args: { id: string }, ctx: Context) => {
          if (!ctx.userId) throw new Error('Not authenticated');
          const [category] = await db
            .select()
            .from(categories)
            .where(eq(categories.id, args.id))
            .limit(1);
          if (!category || category.userId !== ctx.userId) throw new Error('Unknown category');
          await db.delete(categories).where(eq(categories.id, category.id));
          return true;
        },
      },
      assignActivity: {
        // Sets (or, with a null categoryId, clears) an activity's category.
        type: new GraphQLNonNull(entities.types.Activities!),
        args: {
          activityId: { type: new GraphQLNonNull(GraphQLString) },
          categoryId: { type: GraphQLString },
        },
        resolve: async (
          _source,
          args: { activityId: string; categoryId?: string | null },
          ctx: Context,
        ) => {
          if (!ctx.userId) throw new Error('Not authenticated');
          // Ownership runs through the device: activity -> device -> user.
          const [found] = await db
            .select({ activity: activities, ownerId: devices.userId })
            .from(activities)
            .innerJoin(devices, eq(activities.deviceId, devices.id))
            .where(eq(activities.id, args.activityId))
            .limit(1);
          if (!found || found.ownerId !== ctx.userId) throw new Error('Unknown activity');
          if (args.categoryId != null) {
            const [category] = await db
              .select()
              .from(categories)
              .where(eq(categories.id, args.categoryId))
              .limit(1);
            if (!category || category.userId !== ctx.userId) throw new Error('Unknown category');
          }
          // Manual assignment pins the choice against rules; clearing returns
          // the row to the auto-categorization pool.
          const [updated] = await db
            .update(activities)
            .set({
              categoryId: args.categoryId ?? null,
              categorySource: args.categoryId != null ? 'manual' : null,
            })
            .where(eq(activities.id, args.activityId))
            .returning();
          return updated;
        },
      },
      createCategoryRule: {
        type: new GraphQLNonNull(entities.types.CategoryRules!),
        args: {
          categoryId: { type: new GraphQLNonNull(GraphQLString) },
          appPattern: { type: GraphQLString },
          titlePattern: { type: GraphQLString },
          contextPattern: { type: GraphQLString },
          priority: { type: GraphQLInt },
        },
        resolve: async (
          _source,
          args: {
            categoryId: string;
            appPattern?: string | null;
            titlePattern?: string | null;
            contextPattern?: string | null;
            priority?: number | null;
          },
          ctx: Context,
        ) => {
          if (!ctx.userId) throw new Error('Not authenticated');
          if (args.appPattern == null && args.titlePattern == null && args.contextPattern == null) {
            throw new Error('A rule needs an appPattern, titlePattern, and/or contextPattern');
          }
          if (args.appPattern != null) assertValidPattern(args.appPattern);
          if (args.titlePattern != null) assertValidPattern(args.titlePattern);
          if (args.contextPattern != null) assertValidPattern(args.contextPattern);
          const [category] = await db
            .select()
            .from(categories)
            .where(eq(categories.id, args.categoryId))
            .limit(1);
          if (!category || category.userId !== ctx.userId) throw new Error('Unknown category');
          const [row] = await db
            .insert(categoryRules)
            .values({
              id: crypto.randomUUID(),
              userId: ctx.userId,
              categoryId: args.categoryId,
              appPattern: args.appPattern ?? null,
              titlePattern: args.titlePattern ?? null,
              contextPattern: args.contextPattern ?? null,
              priority: args.priority ?? 0,
            })
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
          if (!ctx.userId) throw new Error('Not authenticated');
          const [rule] = await db
            .select()
            .from(categoryRules)
            .where(eq(categoryRules.id, args.id))
            .limit(1);
          if (!rule || rule.userId !== ctx.userId) throw new Error('Unknown rule');
          await db.delete(categoryRules).where(eq(categoryRules.id, rule.id));
          return true;
        },
      },
      applyCategoryRules: {
        // Retroactive sweep over every activity the caller owns (manual
        // assignments excluded). Returns how many activities changed.
        type: new GraphQLNonNull(GraphQLInt),
        resolve: (_source, _args, ctx: Context) => {
          if (!ctx.userId) throw new Error('Not authenticated');
          return sweepRules(db, ctx.userId);
        },
      },
      createContextRule: {
        // Context rules split time WITHIN an app (per book, per project, per
        // site) by extracting the title pattern's first capture group at fold
        // time. Identity-shaping: applies to rows created from now on only —
        // churned titles are gone, so there is no retroactive sweep.
        type: new GraphQLNonNull(entities.types.ContextRules!),
        args: {
          appPattern: { type: GraphQLString },
          titlePattern: { type: new GraphQLNonNull(GraphQLString) },
          priority: { type: GraphQLInt },
        },
        resolve: async (
          _source,
          args: { appPattern?: string | null; titlePattern: string; priority?: number | null },
          ctx: Context,
        ) => {
          if (!ctx.userId) throw new Error('Not authenticated');
          if (args.appPattern != null) assertValidPattern(args.appPattern);
          assertValidContextPattern(args.titlePattern);
          const [row] = await db
            .insert(contextRules)
            .values({
              id: crypto.randomUUID(),
              userId: ctx.userId,
              appPattern: args.appPattern ?? null,
              titlePattern: args.titlePattern,
              priority: args.priority ?? 0,
            })
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
          if (!ctx.userId) throw new Error('Not authenticated');
          const [rule] = await db
            .select()
            .from(contextRules)
            .where(eq(contextRules.id, args.id))
            .limit(1);
          if (!rule || rule.userId !== ctx.userId) throw new Error('Unknown rule');
          await db.delete(contextRules).where(eq(contextRules.id, rule.id));
          return true;
        },
      },
      recordPing: {
        // Nullable: idle pings and pings with no detectable app touch nothing.
        type: entities.types.Activities!,
        args: {
          // Optional: a device API key already identifies the device; sessions
          // (or keys acting on another owned device) can pass it explicitly.
          deviceId: { type: GraphQLString },
          capturedAt: { type: new GraphQLNonNull(GraphQLString) },
          app: { type: GraphQLString },
          title: { type: GraphQLString },
          // Agent-supplied sub-app division (browser hostname). When absent,
          // the user's context rules extract one from the title instead.
          context: { type: GraphQLString },
          idleSeconds: { type: new GraphQLNonNull(GraphQLInt) },
        },
        resolve: async (
          _source,
          args: {
            deviceId?: string | null;
            capturedAt: string;
            app?: string | null;
            title?: string | null;
            context?: string | null;
            idleSeconds: number;
          },
          ctx: Context,
        ) => {
          if (!ctx.userId) throw new Error('Not authenticated');
          const deviceId = args.deviceId ?? ctx.deviceId;
          if (!deviceId) throw new Error('No device: pass deviceId or use a device API key');
          const [device] = await db.select().from(devices).where(eq(devices.id, deviceId)).limit(1);
          if (!device || device.userId !== ctx.userId) throw new Error('Unknown device');
          const capturedAt = new Date(args.capturedAt);
          if (Number.isNaN(capturedAt.getTime())) throw new Error('Invalid capturedAt');
          const context =
            args.context ??
            extractContext(
              await loadContextRules(db, device.userId),
              args.app ?? null,
              args.title ?? null,
            );
          const activity = await foldPing(db, device.id, {
            capturedAt,
            app: args.app ?? null,
            title: args.title ?? null,
            context,
            idleSeconds: args.idleSeconds,
          });
          if (!activity) return null;
          // Lazy auto-categorization: every ping re-evaluates the touched row,
          // so new rows, title churn, and rule changes all converge here.
          return applyRules(db, await loadRules(db, device.userId), activity);
        },
      },
    },
  });

  const schema = new GraphQLSchema({ query, mutation });

  return applyPermissions(schema, permissions);
}
