import { buildSchema as buildDrizzleSchema } from '@vantreeseba/drizzle-graphql';
import { GraphQLError, type GraphQLFieldConfig } from 'graphql';
import type { Db } from '../db/client.ts';
import type { Context } from './context.ts';
import { rowScopes } from './scope.ts';

/**
 * What drizzle-graphql generates from the tables, as this server uses it: the
 * list queries. The object types come along with the queries that return them
 * — domain.graphql names them rather than reaching for them here.
 *
 * Only what createSchema picks ends up in the public schema, and everything
 * that writes is hand-written — so nothing generated needs to be a mutation.
 */
export interface Entities {
  queries: Record<string, GraphQLFieldConfig<unknown, Context>>;
}

/**
 * drizzle v1 RC types the db by its relations config, not its tables, so
 * drizzle-graphql's entity keys can't be inferred statically. Widening to a
 * string-keyed record here keeps the single cast in one place, and the
 * non-null assertions at the pick sites (`entities.queries.devices!`) are what
 * fail loudly if a table is renamed.
 */
export function buildEntities(db: Db): Entities {
  const { entities } = buildDrizzleSchema(db, {
    // Every write in this schema is a domain mutation with its own ownership
    // check and its own side effects (rollups, summary merges, key rotation).
    // Generating CRUD mutations nobody picks would only add Create/Update
    // input types to the printed SDL for operations that don't exist.
    mutations: false,
    features: {
      aggregates: false,
      groupBy: false,
      relationAggregates: false,
      distinct: false,
    },
    // better-auth's own table. Excluding it drops the `Devices.user` relation
    // with it, so an email address is not two hops from any device row.
    exclude: { tables: ['user'] },
    // Ownership, on every path the generated resolvers take (see scope.ts).
    scope: rowScopes,
    // A list query with no `limit` means "every row", which is a promise this
    // server cannot keep for activities. A ceiling, not a clamp: an explicit
    // over-limit is refused rather than quietly truncated, since a short page
    // tells a paginating client it has reached the end when it has not.
    limits: { maxLimit: 1000 },
    // Activities have no natural order in the table. "Recent" is the only
    // reading anyone wants, so a request that names no order gets it.
    defaults: { activities: { orderBy: { startedAt: 'desc' } } },
    onError,
  });
  return entities as unknown as Entities;
}

/**
 * Errors written for a client pass through; everything else is sanitized to
 * `Internal server error` by the library's default.
 *
 * The line is the same one errors.ts draws: a GraphQLError was built to be
 * read (and carries the extensions.code clients branch on), while a driver
 * error carries the statement, its bound parameters and the constraint name.
 * It matters here because a scope hook throws UNAUTHENTICATED from inside a
 * generated resolver, where the sanitizer would otherwise flatten it.
 */
const onError = (error: unknown): Error | undefined =>
  error instanceof GraphQLError ? error : undefined;

/** The field-config shape the generated queries are picked into. */
export type Fields = Record<string, GraphQLFieldConfig<unknown, Context>>;
