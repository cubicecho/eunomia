import { extractFilters, extractOrderBy } from '@vantreeseba/drizzle-graphql';
import { and, type SQL } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import type { GraphQLFieldConfig } from 'graphql';
import type { Context } from './context.ts';

interface ListArgs {
  where?: Record<string, unknown>;
  orderBy?: Record<string, { direction: 'asc' | 'desc'; priority: number }>;
  limit?: number | null;
  offset?: number | null;
}

/** Generated types expect ISO strings where the driver returns Dates. */
const remapRow = (row: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      key,
      value instanceof Date ? value.toISOString() : value,
    ]),
  );

/**
 * Rebuilds a drizzle-graphql list query so every row is fenced by an
 * ownership condition. The caller's `where` is extracted with the fork's own
 * extractFilters and ANDed *under* the scope in SQL, so no filter shape
 * (OR variants included) can widen the result set past what the scope allows.
 * The generated field's type and args are kept; only the resolver changes.
 * Nested relations stay safe transitively: they traverse FK edges from rows
 * that already passed the fence.
 */
export function scopedListField(
  field: GraphQLFieldConfig<unknown, Context>,
  table: PgTable,
  tableName: string,
  scope: (ctx: Context & { userId: string }) => SQL | undefined,
): GraphQLFieldConfig<unknown, Context> {
  return {
    ...field,
    resolve: async (_source, args: ListArgs, ctx) => {
      if (!ctx.userId) throw new Error('Not authenticated');
      const where = and(
        scope(ctx as Context & { userId: string }),
        args.where ? extractFilters(table, tableName, args.where as never) : undefined,
      );
      let query = ctx.db.select().from(table).where(where).$dynamic();
      if (args.orderBy) query = query.orderBy(...extractOrderBy(table, args.orderBy));
      if (args.limit != null) query = query.limit(args.limit);
      if (args.offset != null) query = query.offset(args.offset);
      const rows = (await query) as Record<string, unknown>[];
      return rows.map(remapRow);
    },
  };
}
