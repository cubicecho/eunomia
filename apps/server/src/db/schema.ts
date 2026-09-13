import { buildRelations, createRelationsHelper } from 'drizzle-orm';
import {
  bigint,
  boolean,
  doublePrecision,
  index,
  integer,
  pgTable,
  primaryKey,
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
  // Ours, not better-auth's (it neither reads nor writes it). The IANA zone
  // this user's days split in — summaries.day and every dashboard range. Null
  // follows the server's session zone (TZ), so an install that never sets one
  // behaves as before. Only ever written through setUserTimeZone, which
  // re-buckets the history it can.
  timeZone: text('time_zone'),
  // Ours too. How many days of raw pings and activities to keep for this
  // user, when that is fewer than the server keeps (ACTIVITY_RETENTION_DAYS).
  // Null follows the server. It can only shorten: the operator's setting is
  // what the disk was sized for, and a user can't opt out of it.
  retentionDays: integer('retention_days'),
  // Ours as well: the dashboard's getting-started checklist. When the user put
  // it away, and when they ticked the one step the server can't see done —
  // privacy lists, which live in each agent's own config file and never reach
  // the server. Timestamps rather than booleans for the same price, so "when"
  // is there if anything ever wants it; null is not yet.
  onboardingDismissedAt: timestamp('onboarding_dismissed_at'),
  privacyReviewedAt: timestamp('privacy_reviewed_at'),
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

export const account = pgTable(
  'account',
  {
    id: text('id').primaryKey(),
    // better-auth 1.7 scopes account identity by issuer: 'local:<providerId>'
    // for accounts this server owns, the OIDC issuer URL for federated ones.
    // Without it the adapter refuses every sign-in.
    issuer: text('issuer').notNull(),
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
  },
  (t) => [uniqueIndex('account_issuer_account_id_idx').on(t.issuer, t.accountId)],
);

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
  // Receipt time of the device's last ping (not capturedAt — retroactive
  // syncs shouldn't look stale). Null until the agent's first upload. The
  // dashboard uses this to surface silently dead agents.
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
  // The instant from which this device's raw ping log is complete — every
  // ping captured at or after it is in `pings`. Null means since the device's
  // first ping. Replay only rebuilds from inside the complete part: before it
  // the derived rows came from pings that were never stored (devices older
  // than the log) or have since been pruned. Pruning advances it.
  pingLogFrom: timestamp('ping_log_from', { withTimezone: true }),
  // The earliest capturedAt of a stored ping that arrived after later ones
  // and so could not be folded live (backfill, a merged history, an import).
  // Null when the derived rows are current. A replay from here clears it.
  replayFrom: timestamp('replay_from', { withTimezone: true }),
});

/** The kinds a category can be, in the order the dashboard lists them. */
export const CATEGORY_KINDS = ['focus', 'work', 'neutral', 'personal', 'distracting'] as const;
export type CategoryKind = (typeof CATEGORY_KINDS)[number];

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
    // What sort of time the category holds, for the dashboard's time-by-kind
    // breakdown: deep work, other work, neither, personal time, or time the
    // user would rather spend less of. Neutral until someone says otherwise —
    // which includes every category that existed before kinds did.
    kind: text('kind', { enum: CATEGORY_KINDS }).notNull().default('neutral'),
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
    // Provenance, for rules a starter rule pack wrote: which of the pack's rules
    // this is ('development/apps'), and the pack version that last wrote its
    // patterns. Null for every rule a person wrote. The rule is an ordinary rule
    // either way — editing it keeps the tag, and reinstalling the same version
    // leaves the edit alone. See src/activity/rule-packs.ts.
    pack: text('pack'),
    packVersion: integer('pack_version'),
  },
  (t) => [
    index('category_rules_user_idx').on(t.userId, t.priority),
    // One rule per pack slot per user: installing twice, or twice at once, can
    // never write a slot's rule twice. Rules a person wrote (pack NULL) are
    // distinct under the default NULLS DISTINCT and never collide.
    uniqueIndex('category_rules_user_pack_idx').on(t.userId, t.pack),
  ],
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

// Identity merging: per-user, exact-value rules that rewrite one entry's
// (app, context) key into another's. The fix for the same thing recorded under
// two names — a phone reporting "com.instagram.android" before its agent
// learned to report "Instagram", a browser context left behind by a rewritten
// context rule, an app renamed between agent versions.
//
// Exact strings, not regexes: the user picks the entry to merge off a list of
// what has actually been recorded, so there is nothing for a pattern to
// generalize over and a typo'd regex would silently merge the wrong thing.
//
// fromContext NULL means "every context of fromApp", and then each row keeps
// the context it had (toContext must be null — an app-wide merge renames the
// app, it does not collapse what is inside it). A fromContext that is set
// names one exact entry, and toContext is where that entry lands — null there
// meaning the app's contextless time.
//
// Applied at fold time so future pings land merged, and swept over history
// (activities AND summaries) when created. See src/activity/merge-rules.ts;
// src/activity/merge.ts is the unrelated device merge.
export const mergeRules = pgTable(
  'merge_rules',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    fromApp: text('from_app').notNull(),
    fromContext: text('from_context'),
    toApp: text('to_app').notNull(),
    toContext: text('to_context'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('merge_rules_user_idx').on(t.userId),
    // One rule per source entry, so which rule wins is never a question. NULLS
    // NOT DISTINCT for the same reason summaries needs it: an app-wide rule
    // (from_context NULL) is a source key like any other and must collide with
    // a second one.
    unique('merge_rules_source_idx').on(t.userId, t.fromApp, t.fromContext).nullsNotDistinct(),
  ],
);

// Activity model (decided 2026-08-16): stateless pings folded inline, with
// MULTIPLE open activities per device so context switching doesn't shred the
// data — alternating IDE/browser for an hour is two rows, not a hundred twenty.
// An activity is keyed by (app, context); each ping accrues the elapsed focus
// time to the focused open activity, and an activity auto-closes only after going
// unfocused for CLOSE_AFTER_SECONDS. Idle time accrues to nothing. Derived
// from the raw `pings` log, which replay can rebuild it from. See
// src/activity/fold.ts for the mechanics.
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
    // Double, not real: replay recomputes this in JS, and only a float8 column
    // round-trips a JS number exactly — a real would round every write, so a
    // rebuilt row could differ from the live one in its last few bits.
    activeSeconds: doublePrecision('active_seconds').notNull().default(0),
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

// Focus order: the stretches of time the fold credited to one activity without
// a break, in the order they happened. Activities say how long each (app,
// context) was used, but they overlap — two open rows accrue in turn for as
// long as the user alternates — so they can't say what came after what. A
// segment can: the device's segments never overlap, and read by startedAt they
// are its timeline.
//
// One row per focus change, not per ping. A ping extends the activity's latest
// segment when it continues it exactly, and otherwise starts a new one. A
// segment is exactly the interval the fold accrued, so its span agrees with
// activeSeconds:
//
// - It starts where the ping's accrual starts: the device's previous ping (or
//   ACCRUE_CAP_SECONDS back, when the gap was longer). So it can begin a little
//   before its activity's startedAt, which is the first ping itself.
// - A gap longer than ACCRUE_CAP_SECONDS ends it, because the fold stops
//   crediting there. A silence past CLOSE_AFTER_SECONDS closes the activity,
//   which ends it too.
// - Idle walks it back: when the fold takes the idle ramp back out of an
//   activity, that activity's segments are cut at the moment input stopped,
//   and any that started after it are deleted.
//
// Written by the fold (src/activity/focus.ts), so live ingestion and replay
// write the same rows. References the activity rather than copying its app,
// context and category: those change after the fact (merge rules, manual
// assignment, rule sweeps), and a copy would go stale. Like activity ids,
// segment ids change on replay.
export const focusSegments = pgTable(
  'focus_segments',
  {
    id: text('id').primaryKey(),
    // Denormalized from the activity: every read is "this user's devices over
    // a time range", and that is an index on this table rather than a join.
    deviceId: text('device_id')
      .notNull()
      .references(() => devices.id, { onDelete: 'cascade' }),
    // Cascades, which is how segments are pruned: they go with their activity
    // under ACTIVITY_RETENTION_DAYS, and with it when replay rebuilds.
    activityId: text('activity_id')
      .notNull()
      .references(() => activities.id, { onDelete: 'cascade' }),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    // Equal to startedAt for a focus that accrued nothing: the first ping after
    // a silence, before a second one extends it.
    endedAt: timestamp('ended_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    index('focus_segments_device_started_idx').on(t.deviceId, t.startedAt),
    // The fold's lookups: an activity's latest segment, and its segments
    // an idle walk-back cuts.
    index('focus_segments_activity_started_idx').on(t.activityId, t.startedAt),
  ],
);

// Precomputed aggregates: active seconds per (device, owner's day of start, app,
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
    // 'YYYY-MM-DD' of the activity's startedAt in the device owner's zone
    // (rollup.ts dayOf — the same expression the live summary queries use).
    day: text('day').notNull(),
    app: text('app').notNull(),
    context: text('context'),
    // Deleting a category merges its summary rows into the uncategorized ones
    // in the resolver, so this FK's action never has rows left to touch.
    categoryId: text('category_id').references(() => categories.id, { onDelete: 'set null' }),
    seconds: doublePrecision('seconds').notNull().default(0),
  },
  (t) => [
    // NULLS NOT DISTINCT so the upsert's ON CONFLICT treats "no context" /
    // "no category" as one row instead of accumulating duplicates.
    unique('summaries_key_idx')
      .on(t.deviceId, t.day, t.app, t.context, t.categoryId)
      .nullsNotDistinct(),
  ],
);

// The raw ping log: every ping a device uploaded, as it arrived (after the
// agent's own privacy sanitizer, before any server-side interpretation —
// context here is only what the agent supplied, never what a rule extracted).
// The source of truth activities and summaries are derived from, so a device's
// history can be rebuilt (src/activity/replay.ts) when a late ping lands or the
// derived rows need recomputing. Pruned with ACTIVITY_RETENTION_DAYS.
//
// The hot table: one row per ping, ~10s apart per active device, so it keeps
// no text id and no index beyond its primary key. That key is also the only
// order anything reads it in — a device's pings by time — and `seq` both breaks
// ties and records arrival order within one instant, which matters: the
// Android agent closes one app and opens the next at the same millisecond.
//
// Deliberately left out of `relations` below, which is what drizzle-graphql
// builds its reads from: every window title a device ever reported, row for
// row, is the most sensitive and largest table here, and nothing on the
// dashboard needs it — activities are its readable form.
//
// Stored row for row rather than run-length encoded. Consecutive pings are
// rarely identical once idleSeconds and capturedAt are counted, and exact
// replay needs both, so a run would have to carry every one anyway.
export const pings = pgTable(
  'pings',
  {
    deviceId: text('device_id')
      .notNull()
      .references(() => devices.id, { onDelete: 'cascade' }),
    capturedAt: timestamp('captured_at', { withTimezone: true }).notNull(),
    seq: bigint('seq', { mode: 'number' }).notNull().generatedAlwaysAsIdentity(),
    app: text('app'),
    title: text('title'),
    context: text('context'),
    idleSeconds: integer('idle_seconds').notNull(),
  },
  (t) => [primaryKey({ columns: [t.deviceId, t.capturedAt, t.seq] })],
);

// What a user deleted, per device, so it stays deleted: a ping captured inside
// one is dropped at ingestion rather than logged. Deleting a range or purging
// an app removes what the server holds, but an agent that was offline still
// has pings from that stretch in its outbox, and an old export can be imported
// back — without this, the next upload would quietly restore the history the
// user just asked to be rid of. See src/activity/deletion.ts.
//
// A range erasure (app null) covers every ping captured in [from, to). An app
// erasure covers pings captured before `to` (from null: since the beginning)
// that fold into the entry (app, context) — context null meaning every context
// of the app, as on merge_rules. `to` is never later than the moment of the
// deletion: live pings after it are new history, not the deleted one.
//
// Pruned with the pings (prunePings): one older than the retention cutoff has
// nothing left to protect, since a ping that old is pruned on arrival anyway.
// Not exported and not in `relations` — it's bookkeeping, not history.
export const erasures = pgTable(
  'erasures',
  {
    id: text('id').primaryKey(),
    deviceId: text('device_id')
      .notNull()
      .references(() => devices.id, { onDelete: 'cascade' }),
    from: timestamp('from', { withTimezone: true }),
    to: timestamp('to', { withTimezone: true }).notNull(),
    app: text('app'),
    context: text('context'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  // Ingestion asks "anything ending after this batch's earliest ping?", which
  // for a live upload is nothing at all — one probe here.
  (t) => [index('erasures_device_to_idx').on(t.deviceId, t.to)],
);

// --- relations (drizzle v1 relational query builder; drizzle-graphql uses
// these for eager-loaded nested queries) ---

const r = createRelationsHelper({
  user,
  devices,
  activities,
  focusSegments,
  categories,
  categoryRules,
  contextRules,
  mergeRules,
  summaries,
});

export const relations = buildRelations(
  {
    user,
    devices,
    activities,
    focusSegments,
    categories,
    categoryRules,
    contextRules,
    mergeRules,
    summaries,
  },
  {
    user: {
      devices: r.many.devices({ from: r.user.id, to: r.devices.userId }),
      categories: r.many.categories({ from: r.user.id, to: r.categories.userId }),
      categoryRules: r.many.categoryRules({ from: r.user.id, to: r.categoryRules.userId }),
      contextRules: r.many.contextRules({ from: r.user.id, to: r.contextRules.userId }),
      mergeRules: r.many.mergeRules({ from: r.user.id, to: r.mergeRules.userId }),
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
    focusSegments: {
      device: r.one.devices({ from: r.focusSegments.deviceId, to: r.devices.id }),
      activity: r.one.activities({ from: r.focusSegments.activityId, to: r.activities.id }),
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
    mergeRules: {
      user: r.one.user({ from: r.mergeRules.userId, to: r.user.id }),
    },
  },
);

// Row types for the three tables whose rows leave a resolver without an alias
// of their own already (the rest are named beside the code that folds them:
// Activity, CategoryRule, ContextRule, MergeRule). codegen maps the generated
// GraphQL types onto these, so `return row` is checked against the table the
// field claims to return.
export type Device = typeof devices.$inferSelect;
export type Category = typeof categories.$inferSelect;
export type Summary = typeof summaries.$inferSelect;
export type StoredPing = typeof pings.$inferSelect;
export type FocusSegment = typeof focusSegments.$inferSelect;
export type Erasure = typeof erasures.$inferSelect;
