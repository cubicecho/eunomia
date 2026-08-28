import { readFileSync } from 'node:fs';
import type { MutationResolvers, QueryResolvers } from '@eunomia/gql/resolvers';
import { applyPermissions } from '@vantreeseba/graphql-casl';
import {
  assertObjectType,
  extendSchema,
  type GraphQLFieldResolver,
  GraphQLObjectType,
  GraphQLSchema,
  parse,
} from 'graphql';
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
 * The hand-written half of the schema, as SDL.
 *
 * Read once at module load, from the source tree rather than from a bundle:
 * the server runs under tsx with no build step, and the Dockerfile copies
 * apps/server wholesale, so the file is beside this one in every environment.
 */
const domain = parse(readFileSync(new URL('./domain.graphql', import.meta.url), 'utf8'));

/**
 * The read side: drizzle-graphql's generated list queries, taken as generated.
 *
 * Each is already fenced to the caller's own rows — the ownership predicate is
 * part of the build (scope.ts), not something re-imposed on the resolver here,
 * so it holds on the nested and aggregate paths this pick doesn't cover.
 *
 * This is also what makes the generated object types (Devices, Activities, and
 * everything reachable from them) part of the schema domain.graphql extends,
 * which is how the SDL can name them without redeclaring them.
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
 * Binds the domain resolvers to the fields domain.graphql declared, and
 * refuses anything that doesn't line up in either direction.
 *
 * A resolver for a field the SDL doesn't declare is a name that will never be
 * called; a field the SDL declares with no resolver returns null forever. Both
 * are silent at runtime, so both throw here — at import time, which the tests
 * and the container's first request both reach before any client does.
 *
 * The generated list queries already carry their resolvers through
 * extendSchema (it copies field configs, resolve included), which is why the
 * completeness check covers Query as well as Mutation.
 */
function attachResolvers(
  schema: GraphQLSchema,
  resolvers: { Query: QueryResolvers; Mutation: MutationResolvers },
): GraphQLSchema {
  for (const [typeName, fields] of Object.entries(resolvers)) {
    const declared = assertObjectType(schema.getType(typeName)).getFields();
    for (const [name, resolve] of Object.entries(fields)) {
      const field = declared[name];
      if (!field) throw new Error(`No ${typeName}.${name} in the schema to resolve`);
      field.resolve = resolve as GraphQLFieldResolver<unknown, Context>;
    }
    for (const [name, field] of Object.entries(declared)) {
      if (!field.resolve) throw new Error(`No resolver for ${typeName}.${name}`);
    }
  }
  return schema;
}

/**
 * Assembles the executable schema: the generated reads, extended with the
 * hand-written SDL, resolved by the domain modules beside this file, with CASL
 * permissions applied over the whole thing.
 *
 * What's picked here is what exists: the generated CRUD for auth tables and
 * raw device mutations is deliberately left out. Auth is GraphQL too
 * (signUp/signIn/signOut via the injected gateway) — the server mounts no
 * better-auth REST routes.
 */
export function createSchema(db: Db, auth: AuthGateway) {
  const entities = buildEntities(db);
  const generated = new GraphQLSchema({
    query: new GraphQLObjectType({ name: 'Query', fields: listQueries(entities) }),
  });
  const schema = attachResolvers(extendSchema(generated, domain), {
    Query: {
      ...summaryFields(db),
      me: (_source, _args, ctx) => ctx.userId ?? null,
    },
    Mutation: {
      ...authFields(auth),
      ...deviceFields(db, auth),
      ...categoryFields(db),
      ...ruleFields(db),
      ...mergeFields(db),
      ...pingFields(db),
    },
  });
  return applyPermissions<Resolvers>(schema, permissions);
}
