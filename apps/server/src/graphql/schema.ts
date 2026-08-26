import { buildSchema as buildDrizzleSchema } from '@vantreeseba/drizzle-graphql';
import { applyPermissions } from '@vantreeseba/graphql-casl';
import { and, eq, inArray, type SQL, sql } from 'drizzle-orm';
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
import { mergeCategorySummaries, moveRolledSeconds } from '../activity/rollup.ts';
import { applyRules, assertValidPattern, loadRules, sweepRules } from '../activity/rules.ts';
import type { AuthGateway } from '../auth.ts';
import type { Db } from '../db/client.ts';
import {
  activities,
  apikey,
  categories,
  categoryRules,
  contextRules,
  devices,
  summaries,
} from '../db/schema.ts';
import { badInput, notFound, rateLimited, unauthenticated } from '../errors.ts';
import { createRateLimiter } from '../rate-limit.ts';
import type { Context } from './context.ts';
import { permissions } from './permissions.ts';
import { scopedListField } from './scoped.ts';

/**
 * The deviceId a stored apikey row was minted for, or null. The better-auth
 * plugin JSON-serializes the metadata column (double-encoded in some
 * versions), so tolerate both encodings and anything unparseable.
 */
function keyMetadataDeviceId(metadata: string | null): string | null {
  if (!metadata) return null;
  try {
    let parsed: unknown = JSON.parse(metadata);
    if (typeof parsed === 'string') parsed = JSON.parse(parsed);
    const deviceId = (parsed as Record<string, unknown> | null)?.deviceId;
    return typeof deviceId === 'string' ? deviceId : null;
  } catch {
    return null;
  }
}

// Login is unauthenticated, so its cost is borne by whoever can reach the
// port. Per-address first (that's the mailbombing target), then a total across
// all addresses so spraying can't walk around it. Generous enough that a
// household of real users never sees them.
const LOGIN_WINDOW_MS = 15 * 60_000;
const LOGIN_ATTEMPTS_PER_EMAIL = 5;
const LOGIN_ATTEMPTS_TOTAL = 100;

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

  // Dashboard aggregate row: active seconds per category per day (server zone).
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

  // Dashboard aggregate row: active seconds per app (and per context within
  // it) over a range.
  const appContextSummaryType = new GraphQLObjectType({
    name: 'AppContextSummary',
    fields: {
      app: { type: new GraphQLNonNull(GraphQLString) },
      // Null = the app's time with no finer division.
      context: { type: GraphQLString },
      seconds: { type: new GraphQLNonNull(GraphQLFloat) },
    },
  });

  /**
   * Whole-day window [from, to) resolved in the SERVER's time zone — the same
   * zone rollup buckets summaries.day into (db/client.ts sets the session zone
   * from TZ). Both ends truncate to local midnight, so a bare 'YYYY-MM-DD'
   * from the dashboard means that calendar day here, not in UTC.
   *
   * The truncation happens in SQL, not JS, and that is the whole point: a JS
   * Date is an instant, so filtering startedAt by instants cut the live half of
   * a summary at UTC midnight while the rolled half had been cut at local
   * midnight. On a non-UTC server the two halves then disagreed, and today's
   * evening read as empty until the next 15-minute rollup moved it across.
   */
  const parseRange = (args: { from: string; to: string }): { from: SQL; to: SQL } => {
    for (const value of [args.from, args.to]) {
      if (Number.isNaN(new Date(value).getTime())) throw badInput('Invalid date range');
    }
    return {
      from: sql`date_trunc('day', ${args.from}::timestamptz)`,
      to: sql`date_trunc('day', ${args.to}::timestamptz)`,
    };
  };

  /** The window over raw activity rows — the not-yet-rolled-up half. */
  const liveDayBounds = (from: SQL, to: SQL) => [
    sql`${activities.startedAt} >= ${from}`,
    sql`${activities.startedAt} < ${to}`,
  ];

  /** The same window over rolled rows, which only remember their day string. */
  const summaryDayBounds = (from: SQL, to: SQL) => [
    sql`${summaries.day} >= to_char(${from}, 'YYYY-MM-DD')`,
    sql`${summaries.day} < to_char(${to}, 'YYYY-MM-DD')`,
  ];

  /** Merges rolled and live aggregate rows sharing a key, summing seconds. */
  const mergeSummaries = <T extends { seconds: number }>(
    rows: T[],
    keyOf: (row: T) => string,
  ): T[] => {
    const merged = new Map<string, T>();
    for (const row of rows) {
      const existing = merged.get(keyOf(row));
      if (existing) {
        existing.seconds += row.seconds;
      } else {
        merged.set(keyOf(row), { ...row });
      }
    }
    // Category moves can leave zeroed summary rows behind — not worth a bar.
    return [...merged.values()].filter((row) => row.seconds > 0);
  };

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
        // Seconds of active time per category per day, for the whole days
        // [from, to) in the server's time zone.
        // Each activity's whole activeSeconds lands on the day it started —
        // activities are short-lived (auto-closed after 15 min unfocused), so
        // midnight-spanning error is negligible for a dashboard. Served from
        // the precomputed summaries plus a live aggregation over whatever
        // hasn't been rolled up yet.
        type: new GraphQLNonNull(new GraphQLList(new GraphQLNonNull(categoryDaySummaryType))),
        args: {
          from: { type: new GraphQLNonNull(GraphQLString) },
          to: { type: new GraphQLNonNull(GraphQLString) },
        },
        resolve: async (_source, args: { from: string; to: string }, ctx: Context) => {
          if (!ctx.userId) throw unauthenticated();
          const { from, to } = parseRange(args);
          const rolled = await db
            .select({
              day: summaries.day,
              categoryId: summaries.categoryId,
              name: categories.name,
              color: categories.color,
              seconds: sql<number>`sum(${summaries.seconds})::float`,
            })
            .from(summaries)
            .innerJoin(devices, eq(summaries.deviceId, devices.id))
            .leftJoin(categories, eq(summaries.categoryId, categories.id))
            .where(and(eq(devices.userId, ctx.userId), ...summaryDayBounds(from, to)))
            .groupBy(summaries.day, summaries.categoryId, categories.name, categories.color);
          const day = sql<string>`to_char(date_trunc('day', ${activities.startedAt}), 'YYYY-MM-DD')`;
          const live = await db
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
                eq(activities.rolledUp, false),
                ...liveDayBounds(from, to),
              ),
            )
            .groupBy(day, activities.categoryId, categories.name, categories.color);
          return mergeSummaries(
            [...rolled, ...live],
            (row) => `${row.day}\n${row.categoryId ?? ''}`,
          ).sort(
            (a, b) =>
              a.day.localeCompare(b.day) ||
              // Uncategorized last within a day, like SQL's default nulls-last.
              (a.categoryId ?? '￿').localeCompare(b.categoryId ?? '￿'),
          );
        },
      },
      appSummary: {
        // Seconds of active time per (app, context) for [from, to), largest
        // first — the dashboard's top-apps list without shipping raw
        // activities. Same rolled + live merge as categorySummary.
        type: new GraphQLNonNull(new GraphQLList(new GraphQLNonNull(appContextSummaryType))),
        args: {
          from: { type: new GraphQLNonNull(GraphQLString) },
          to: { type: new GraphQLNonNull(GraphQLString) },
        },
        resolve: async (_source, args: { from: string; to: string }, ctx: Context) => {
          if (!ctx.userId) throw unauthenticated();
          const { from, to } = parseRange(args);
          const rolled = await db
            .select({
              app: summaries.app,
              context: summaries.context,
              seconds: sql<number>`sum(${summaries.seconds})::float`,
            })
            .from(summaries)
            .innerJoin(devices, eq(summaries.deviceId, devices.id))
            .where(and(eq(devices.userId, ctx.userId), ...summaryDayBounds(from, to)))
            .groupBy(summaries.app, summaries.context);
          const live = await db
            .select({
              app: activities.app,
              context: activities.context,
              seconds: sql<number>`sum(${activities.activeSeconds})::float`,
            })
            .from(activities)
            .innerJoin(devices, eq(activities.deviceId, devices.id))
            .where(
              and(
                eq(devices.userId, ctx.userId),
                eq(activities.rolledUp, false),
                ...liveDayBounds(from, to),
              ),
            )
            .groupBy(activities.app, activities.context);
          return mergeSummaries(
            [...rolled, ...live],
            (row) => `${row.app}\n${row.context ?? ''}`,
          ).sort((a, b) => b.seconds - a.seconds);
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

  const perEmailLogins = createRateLimiter(LOGIN_ATTEMPTS_PER_EMAIL, LOGIN_WINDOW_MS);
  const allLogins = createRateLimiter(LOGIN_ATTEMPTS_TOTAL, LOGIN_WINDOW_MS);
  const throttleLogin = (email: string): void => {
    if (!perEmailLogins.allow(email.trim().toLowerCase()) || !allLogins.allow('*')) {
      throw rateLimited('Too many sign-in attempts; try again in a few minutes');
    }
  };

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
        resolve: (_source, args: { email: string; password: string; name: string }) => {
          throttleLogin(args.email);
          return auth.signUp(args);
        },
      },
      signIn: {
        type: new GraphQLNonNull(authSessionType),
        args: {
          email: { type: new GraphQLNonNull(GraphQLString) },
          password: { type: new GraphQLNonNull(GraphQLString) },
        },
        resolve: (_source, args: { email: string; password: string }) => {
          throttleLogin(args.email);
          return auth.signIn(args);
        },
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
          const email = args.email.toLowerCase().trim();
          throttleLogin(email);
          const { token } = await auth.requestMagicLink(email);
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
      sessionFromDeviceKey: {
        // Trades a device API key (x-api-key) for a short-lived bearer
        // session, so the desktop app can open the dashboard in an embedded
        // window without a second sign-in — and without handing its
        // long-lived key to the web view. Device-key contexts only (see
        // permissions); no throttle needed since it requires a valid key.
        type: new GraphQLNonNull(authSessionType),
        resolve: (_source, _args, ctx: Context) => {
          if (!ctx.deviceId || !ctx.userId) throw unauthenticated();
          return auth.sessionForDevice(ctx.userId);
        },
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
          if (!ctx.userId) throw unauthenticated();
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
      renameDevice: {
        type: new GraphQLNonNull(entities.types.Devices!),
        args: {
          id: { type: new GraphQLNonNull(GraphQLString) },
          name: { type: new GraphQLNonNull(GraphQLString) },
        },
        resolve: async (_source, args: { id: string; name: string }, ctx: Context) => {
          if (!ctx.userId) throw unauthenticated();
          const [device] = await db.select().from(devices).where(eq(devices.id, args.id)).limit(1);
          if (!device || device.userId !== ctx.userId) throw notFound('Unknown device');
          const [updated] = await db
            .update(devices)
            .set({ name: args.name })
            .where(eq(devices.id, device.id))
            .returning();
          return updated;
        },
      },
      deleteDevice: {
        // True when the device was deleted. Its activities cascade away, and
        // its API keys are revoked (only hashes are stored, so deleting the
        // rows is a full revocation) — the agent's next upload gets rejected.
        type: new GraphQLNonNull(GraphQLBoolean),
        args: {
          id: { type: new GraphQLNonNull(GraphQLString) },
        },
        resolve: async (_source, args: { id: string }, ctx: Context) => {
          if (!ctx.userId) throw unauthenticated();
          const [device] = await db.select().from(devices).where(eq(devices.id, args.id)).limit(1);
          if (!device || device.userId !== ctx.userId) throw notFound('Unknown device');
          // Keys are matched by the deviceId minted into their metadata. The
          // plugin JSON-serializes that column, so match in JS rather than
          // guessing its exact encoding in SQL.
          const keys = await db
            .select({ id: apikey.id, metadata: apikey.metadata })
            .from(apikey)
            .where(eq(apikey.referenceId, ctx.userId));
          const stale = keys
            .filter((key) => keyMetadataDeviceId(key.metadata) === device.id)
            .map((key) => key.id);
          if (stale.length > 0) await db.delete(apikey).where(inArray(apikey.id, stale));
          await db.delete(devices).where(eq(devices.id, device.id));
          return true;
        },
      },
      createCategory: {
        type: new GraphQLNonNull(entities.types.Categories!),
        args: {
          name: { type: new GraphQLNonNull(GraphQLString) },
          color: { type: GraphQLString },
        },
        resolve: async (_source, args: { name: string; color?: string | null }, ctx: Context) => {
          if (!ctx.userId) throw unauthenticated();
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
          if (!ctx.userId) throw unauthenticated();
          const [category] = await db
            .select()
            .from(categories)
            .where(eq(categories.id, args.id))
            .limit(1);
          if (!category || category.userId !== ctx.userId) throw notFound('Unknown category');
          // Summary rows can't ride the FK's set-null (it would collide with
          // existing uncategorized rows) — merge them first.
          await mergeCategorySummaries(db, category.id);
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
          if (!ctx.userId) throw unauthenticated();
          // Ownership runs through the device: activity -> device -> user.
          const [found] = await db
            .select({ activity: activities, ownerId: devices.userId })
            .from(activities)
            .innerJoin(devices, eq(activities.deviceId, devices.id))
            .where(eq(activities.id, args.activityId))
            .limit(1);
          if (!found || found.ownerId !== ctx.userId) throw notFound('Unknown activity');
          if (args.categoryId != null) {
            const [category] = await db
              .select()
              .from(categories)
              .where(eq(categories.id, args.categoryId))
              .limit(1);
            if (!category || category.userId !== ctx.userId) throw notFound('Unknown category');
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
          // If the activity's seconds are already summarized, carry them over.
          await moveRolledSeconds(
            db,
            found.activity,
            found.activity.categoryId,
            args.categoryId ?? null,
          );
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
          if (!ctx.userId) throw unauthenticated();
          if (args.appPattern == null && args.titlePattern == null && args.contextPattern == null) {
            throw badInput('A rule needs an appPattern, titlePattern, and/or contextPattern');
          }
          if (args.appPattern != null) assertValidPattern(args.appPattern);
          if (args.titlePattern != null) assertValidPattern(args.titlePattern);
          if (args.contextPattern != null) assertValidPattern(args.contextPattern);
          const [category] = await db
            .select()
            .from(categories)
            .where(eq(categories.id, args.categoryId))
            .limit(1);
          if (!category || category.userId !== ctx.userId) throw notFound('Unknown category');
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
          if (!ctx.userId) throw unauthenticated();
          const [rule] = await db
            .select()
            .from(categoryRules)
            .where(eq(categoryRules.id, args.id))
            .limit(1);
          if (!rule || rule.userId !== ctx.userId) throw notFound('Unknown rule');
          await db.delete(categoryRules).where(eq(categoryRules.id, rule.id));
          return true;
        },
      },
      applyCategoryRules: {
        // Retroactive sweep over every activity the caller owns (manual
        // assignments excluded). Returns how many activities changed.
        type: new GraphQLNonNull(GraphQLInt),
        resolve: (_source, _args, ctx: Context) => {
          if (!ctx.userId) throw unauthenticated();
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
          if (!ctx.userId) throw unauthenticated();
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
          if (!ctx.userId) throw unauthenticated();
          const [rule] = await db
            .select()
            .from(contextRules)
            .where(eq(contextRules.id, args.id))
            .limit(1);
          if (!rule || rule.userId !== ctx.userId) throw notFound('Unknown rule');
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
          if (!ctx.userId) throw unauthenticated();
          const deviceId = args.deviceId ?? ctx.deviceId;
          if (!deviceId) throw badInput('No device: pass deviceId or use a device API key');
          const [device] = await db.select().from(devices).where(eq(devices.id, deviceId)).limit(1);
          if (!device || device.userId !== ctx.userId) throw notFound('Unknown device');
          const capturedAt = new Date(args.capturedAt);
          if (Number.isNaN(capturedAt.getTime())) throw badInput('Invalid capturedAt');
          // Liveness marker for the dashboard. Receipt time, not capturedAt:
          // a retroactive mobile sync means the agent is alive NOW. Throttled
          // — within one batched upload only the first ping writes.
          const now = new Date();
          if (!device.lastSeenAt || now.getTime() - device.lastSeenAt.getTime() > 60_000) {
            await db.update(devices).set({ lastSeenAt: now }).where(eq(devices.id, device.id));
          }
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
