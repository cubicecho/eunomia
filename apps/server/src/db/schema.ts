import { buildRelations, createRelationsHelper } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  pgTable,
  real,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

// --- better-auth tables (email/password + apiKey plugin) ---
// Keep in sync with better-auth; regenerate with `npx @better-auth/cli generate`
// if the auth config changes.

export const user = pgTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const session = pgTable('session', {
  id: text('id').primaryKey(),
  expiresAt: timestamp('expires_at').notNull(),
  token: text('token').notNull().unique(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const account = pgTable('account', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  accessTokenExpiresAt: timestamp('access_token_expires_at'),
  refreshTokenExpiresAt: timestamp('refresh_token_expires_at'),
  scope: text('scope'),
  password: text('password'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const verification = pgTable('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const apikey = pgTable('apikey', {
  id: text('id').primaryKey(),
  configId: text('config_id').notNull().default('default'),
  name: text('name'),
  start: text('start'),
  prefix: text('prefix'),
  key: text('key').notNull(),
  // The plugin's generic owner column ("user" references mode = a user id).
  referenceId: text('reference_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  refillInterval: integer('refill_interval'),
  refillAmount: integer('refill_amount'),
  lastRefillAt: timestamp('last_refill_at'),
  enabled: boolean('enabled').notNull().default(true),
  rateLimitEnabled: boolean('rate_limit_enabled').notNull().default(true),
  rateLimitTimeWindow: integer('rate_limit_time_window'),
  rateLimitMax: integer('rate_limit_max'),
  requestCount: integer('request_count').notNull().default(0),
  remaining: integer('remaining'),
  lastRequest: timestamp('last_request'),
  expiresAt: timestamp('expires_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
  permissions: text('permissions'),
  // JSON-serialized by the plugin; carries { deviceId } for device keys.
  metadata: text('metadata'),
});

// --- domain tables ---

export const devices = pgTable('devices', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  platform: text('platform', { enum: ['windows', 'macos', 'linux', 'android'] }).notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

// User-defined buckets activities get assigned to ("Work", "Gaming", ...).
// Per-user, not global: two users' "Work" mean different things.
export const categories = pgTable(
  'categories',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    // Optional display color for dashboards (any CSS color string).
    color: text('color'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('categories_user_name_idx').on(t.userId, t.name)],
);

// Auto-categorization: per-user, priority-ordered regex rules (first match
// wins). Evaluated lazily on every ping for the touched activity and on demand
// via the applyCategoryRules sweep — never against manual assignments.
export const categoryRules = pgTable(
  'category_rules',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    // Rules die with their category; assignments they made are cleared lazily.
    categoryId: text('category_id')
      .notNull()
      .references(() => categories.id, { onDelete: 'cascade' }),
    // Case-insensitive regexes; every present pattern must match, and title/
    // context rules never match an activity missing that field. At least one
    // is required.
    appPattern: text('app_pattern'),
    titlePattern: text('title_pattern'),
    contextPattern: text('context_pattern'),
    // Lower runs first; ties broken by creation time.
    priority: integer('priority').notNull().default(0),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [index('category_rules_user_idx').on(t.userId, t.priority)],
);

// Context extraction: per-user, priority-ordered rules that pull a sub-app
// "context" out of the window title — the book open in novelWriter, the
// Ableton project, the IDE workspace. First match wins; the title pattern's
// first capture group becomes the context. Evaluated server-side at fold time
// so supporting a new app is a rule insert, not an agent release. Browsers
// bypass this: the agent supplies the hostname directly (from the URL, which
// titles can't yield reliably), and an agent-supplied context always wins.
export const contextRules = pgTable(
  'context_rules',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    // Optional case-insensitive regex narrowing which apps the rule applies to.
    appPattern: text('app_pattern'),
    // Required case-insensitive regex with at least one capture group; capture
    // group 1 (trimmed) is the extracted context.
    titlePattern: text('title_pattern').notNull(),
    // Lower runs first; ties broken by creation time.
    priority: integer('priority').notNull().default(0),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [index('context_rules_user_idx').on(t.userId, t.priority)],
);

// Activity model (decided 2026-08-16): stateless pings folded inline, with
// MULTIPLE open activities per device so context switching doesn't shred the
// data — alternating IDE/browser for an hour is two rows, not a hundred twenty.
// An activity is keyed by (app, context); each ping accrues the elapsed focus
// time to the focused open activity, and an activity auto-closes only after going
// unfocused for CLOSE_AFTER_SECONDS. Idle time accrues to nothing. No raw ping
// storage. See src/activity/fold.ts for the mechanics.
export const activities = pgTable(
  'activities',
  {
    id: text('id').primaryKey(),
    deviceId: text('device_id')
      .notNull()
      .references(() => devices.id, { onDelete: 'cascade' }),
    // Executable/app identifier the activity is keyed by.
    app: text('app').notNull(),
    // Optional sub-app division the activity is ALSO keyed by: browser site
    // (agent-supplied hostname), open project/document/workspace (extracted
    // from the title by the user's context rules). Null = no finer division;
    // gmail and youtube in the same browser are separate activity rows.
    context: text('context'),
    // Most recently seen window title (titles churn — tabs, editors — while the
    // activity row stays put; only the latest is kept).
    title: text('title'),
    // First focus.
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    // Last focused, non-idle ping.
    lastActiveAt: timestamp('last_active_at', { withTimezone: true }).notNull(),
    // Accumulated foreground non-idle seconds — the number dashboards sum.
    // Distinct from the startedAt..lastActiveAt wall-clock span, which also
    // contains time spent focused on other apps.
    activeSeconds: real('active_seconds').notNull().default(0),
    // Null = open (may still accrue). Set to lastActiveAt when the activity
    // goes unfocused past the close threshold.
    closedAt: timestamp('closed_at', { withTimezone: true }),
    // Assignment is per activity row; a deleted category unassigns rather
    // than deleting the time itself.
    categoryId: text('category_id').references(() => categories.id, { onDelete: 'set null' }),
    // Who set categoryId: 'manual' (assignActivity — rules never touch it
    // again) or 'rule' (auto; re-evaluated on later pings/sweeps). Null when
    // unassigned, leaving the row open to auto-categorization.
    categorySource: text('category_source', { enum: ['manual', 'rule'] }),
    // Whether this (closed) activity's seconds have been folded into the
    // summaries table. Category changes on rolled rows must move their seconds
    // between summary rows (see src/activity/rollup.ts).
    rolledUp: boolean('rolled_up').notNull().default(false),
  },
  (t) => [
    index('activities_device_closed_idx').on(t.deviceId, t.closedAt),
    index('activities_category_idx').on(t.categoryId),
  ],
);

// Precomputed aggregates: active seconds per (device, UTC day of start, app,
// context, category), folded from closed activities by the rollup job so
// dashboards read a few summary rows instead of every raw activity. Raw rows
// are kept (marked rolledUp) for drill-down; summaries are the fast path and
// would survive a future retention sweep of old raw activities.
export const summaries = pgTable(
  'summaries',
  {
    id: text('id').primaryKey(),
    deviceId: text('device_id')
      .notNull()
      .references(() => devices.id, { onDelete: 'cascade' }),
    // 'YYYY-MM-DD' of the activity's startedAt (server-timezone day, same
    // date_trunc the live summary queries use).
    day: text('day').notNull(),
    app: text('app').notNull(),
    context: text('context'),
    // Deleting a category merges its summary rows into the uncategorized ones
    // in the resolver, so this FK's action never has rows left to touch.
    categoryId: text('category_id').references(() => categories.id, { onDelete: 'set null' }),
    seconds: real('seconds').notNull().default(0),
  },
  (t) => [
    // NULLS NOT DISTINCT so the upsert's ON CONFLICT treats "no context" /
    // "no category" as one row instead of accumulating duplicates.
    unique('summaries_key_idx')
      .on(t.deviceId, t.day, t.app, t.context, t.categoryId)
      .nullsNotDistinct(),
  ],
);

// --- relations (drizzle v1 relational query builder; drizzle-graphql uses
// these for eager-loaded nested queries) ---

const r = createRelationsHelper({
  user,
  devices,
  activities,
  categories,
  categoryRules,
  contextRules,
  summaries,
});

export const relations = buildRelations(
  { user, devices, activities, categories, categoryRules, contextRules, summaries },
  {
    user: {
      devices: r.many.devices({ from: r.user.id, to: r.devices.userId }),
      categories: r.many.categories({ from: r.user.id, to: r.categories.userId }),
      categoryRules: r.many.categoryRules({ from: r.user.id, to: r.categoryRules.userId }),
      contextRules: r.many.contextRules({ from: r.user.id, to: r.contextRules.userId }),
    },
    devices: {
      user: r.one.user({ from: r.devices.userId, to: r.user.id }),
      activities: r.many.activities({ from: r.devices.id, to: r.activities.deviceId }),
      summaries: r.many.summaries({ from: r.devices.id, to: r.summaries.deviceId }),
    },
    summaries: {
      device: r.one.devices({ from: r.summaries.deviceId, to: r.devices.id }),
    },
    activities: {
      device: r.one.devices({ from: r.activities.deviceId, to: r.devices.id }),
      category: r.one.categories({ from: r.activities.categoryId, to: r.categories.id }),
    },
    categories: {
      user: r.one.user({ from: r.categories.userId, to: r.user.id }),
      activities: r.many.activities({ from: r.categories.id, to: r.activities.categoryId }),
      rules: r.many.categoryRules({ from: r.categories.id, to: r.categoryRules.categoryId }),
    },
    categoryRules: {
      user: r.one.user({ from: r.categoryRules.userId, to: r.user.id }),
      category: r.one.categories({ from: r.categoryRules.categoryId, to: r.categories.id }),
    },
    contextRules: {
      user: r.one.user({ from: r.contextRules.userId, to: r.user.id }),
    },
  },
);
