import { buildSchema as buildDrizzleSchema } from '@vantreeseba/drizzle-graphql';
import type { GraphQLFieldConfig, GraphQLInputObjectType, GraphQLObjectType } from 'graphql';
import type { Db } from '../db/client.ts';
import type { Context } from './context.ts';

/**
 * What drizzle-graphql generates from the tables: CRUD queries and mutations,
 * plus the object types the domain resolvers return.
 *
 * Only what createSchema picks ends up in the public schema — the generated
 * auth-table CRUD and raw device mutations are never exposed.
 */
export interface Entities {
  queries: Record<string, GraphQLFieldConfig<unknown, Context>>;
  mutations: Record<string, GraphQLFieldConfig<unknown, Context>>;
  types: Record<string, GraphQLObjectType>;
  inputs: Record<string, GraphQLInputObjectType>;
}

/**
 * drizzle v1 RC types the db by its relations config, not its tables, so
 * drizzle-graphql's entity keys can't be inferred statically. Widening to
 * string-keyed records here keeps the single cast in one place, and the
 * non-null assertions at the pick sites (`entities.types.Devices!`) are what
 * fail loudly if a table is renamed.
 */
export function buildEntities(db: Db): Entities {
  return buildDrizzleSchema(db).entities as unknown as Entities;
}

/** The field shape every domain module in this directory returns. */
export type Fields = Record<string, GraphQLFieldConfig<unknown, Context>>;
