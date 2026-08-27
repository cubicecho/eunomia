import type { ScopeConfig } from '@vantreeseba/drizzle-graphql';
import { eq, inArray } from 'drizzle-orm';
import {
  type activities,
  type categories,
  type categoryRules,
  type contextRules,
  devices,
  type mergeRules,
  type summaries,
} from '../db/schema.ts';
import type { Context } from './context.ts';
import { requireUser } from './guards.ts';

/** The ids of the caller's own devices — the fence for the tables hung off one. */
const ownDeviceIds = (ctx: Context) =>
  ctx.db
    .select({ id: devices.id })
    .from(devices)
    .where(eq(devices.userId, requireUser(ctx)));

/**
 * The ownership fence on every generated read.
 *
 * drizzle-graphql ANDs these predicates on last, after whatever the client
 * sent, so no `where` a caller can write — OR branches, relation filters,
 * anything — widens a result set past the rows they own. It reaches every path
 * the generated resolvers take, which a fence in a root resolver could not: a
 * nested `devices { activities { … } }` never passes through the root field,
 * and neither does a cursor page or an aggregate.
 *
 * Keyed by the Drizzle schema key, and a key matching no table fails the
 * build — so a renamed table cannot quietly stop being fenced.
 *
 * `table` is the instance the current statement runs against, which for a
 * nested read is Drizzle's aliased copy. Every predicate is built from that
 * argument rather than from the imported table object, which would name the
 * wrong alias inside a relation.
 *
 * requireUser throws rather than returning undefined for an anonymous caller:
 * undefined means "no restriction" here, and falling open is the one thing a
 * fence must not do. The permissions layer already rejects those requests
 * before a resolver runs (permissions.ts), so this is the second lock.
 */
export const rowScopes: ScopeConfig<Context> = {
  devices: (ctx, table: typeof devices) => eq(table.userId, requireUser(ctx)),
  categories: (ctx, table: typeof categories) => eq(table.userId, requireUser(ctx)),
  categoryRules: (ctx, table: typeof categoryRules) => eq(table.userId, requireUser(ctx)),
  contextRules: (ctx, table: typeof contextRules) => eq(table.userId, requireUser(ctx)),
  mergeRules: (ctx, table: typeof mergeRules) => eq(table.userId, requireUser(ctx)),
  // Activities and summaries carry no userId of their own — ownership runs
  // through the owning device, so their fence is a subquery.
  activities: (ctx, table: typeof activities) => inArray(table.deviceId, ownDeviceIds(ctx)),
  summaries: (ctx, table: typeof summaries) => inArray(table.deviceId, ownDeviceIds(ctx)),
};
