import { applyPermissions } from '@vantreeseba/graphql-casl';
import { GraphQLObjectType, GraphQLSchema, GraphQLString } from 'graphql';
import type { AuthGateway } from '../auth.ts';
import type { Db } from '../db/client.ts';
import { authFields } from './auth-fields.ts';
import { categoryFields } from './category-fields.ts';
import type { Context } from './context.ts';
import { deviceFields } from './device-fields.ts';
import { buildEntities, type Entities, type Fields } from './entities.ts';
import { mergeFields } from './merge-fields.ts';
import { permissions, type Resolvers } from './permissions.ts';
import { pingFields } from './ping-fields.ts';
import { ruleFields } from './rule-fields.ts';
import { summaryFields } from './summaries.ts';

/**
 * The read side: drizzle-graphql's generated list queries, taken as generated.
 *
 * Each is already fenced to the caller's own rows — the ownership predicate is
 * part of the build (scope.ts), not something re-imposed on the resolver here,
 * so it holds on the nested and aggregate paths this pick doesn't cover.
 */
function listQueries(entities: Entities) {
  return {
    devices: entities.queries.devices!,
    activities: entities.queries.activities!,
    categories: entities.queries.categories!,
    categoryRules: entities.queries.categoryRules!,
    contextRules: entities.queries.contextRules!,
    mergeRules: entities.queries.mergeRules!,
  } satisfies Fields;
}

/**
 * The two field maps, kept as functions of their own so their key sets are
 * types: permissions.ts requires a rule for exactly these names, which is what
 * makes an unguarded new field a compile error rather than a live one.
 *
 * Field order is the printed SDL's order, and the SDL is a committed artifact,
 * so reordering these spreads shows up as codegen churn in every consumer.
 */
export function queryFields(db: Db, entities: Entities) {
  return {
    ...listQueries(entities),
    ...summaryFields(db),
    me: {
      type: GraphQLString,
      resolve: (_source: unknown, _args: unknown, ctx: Context) => ctx.userId ?? null,
    },
  } satisfies Fields;
}

export function mutationFields(db: Db, auth: AuthGateway, entities: Entities) {
  return {
    ...authFields(auth),
    ...deviceFields(db, auth, entities),
    ...categoryFields(db, entities),
    ...ruleFields(db, entities),
    ...mergeFields(db, entities),
    ...pingFields(db, entities),
  } satisfies Fields;
}

/**
 * Assembles the executable schema from the domain modules beside this file,
 * with CASL permissions applied over the whole thing.
 *
 * What's picked here is what exists: the generated CRUD for auth tables and
 * raw device mutations is deliberately left out. Auth is GraphQL too
 * (signUp/signIn/signOut via the injected gateway) — the server mounts no
 * better-auth REST routes.
 */
export function createSchema(db: Db, auth: AuthGateway) {
  const entities = buildEntities(db);
  const query = new GraphQLObjectType({ name: 'Query', fields: queryFields(db, entities) });
  const mutation = new GraphQLObjectType({
    name: 'Mutation',
    fields: mutationFields(db, auth, entities),
  });
  return applyPermissions<Resolvers>(new GraphQLSchema({ query, mutation }), permissions);
}
