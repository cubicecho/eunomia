import { applyPermissions } from '@vantreeseba/graphql-casl';
import { eq, inArray } from 'drizzle-orm';
import { GraphQLObjectType, GraphQLSchema, GraphQLString } from 'graphql';
import type { AuthGateway } from '../auth.ts';
import type { Db } from '../db/client.ts';
import { activities, categories, categoryRules, contextRules, devices } from '../db/schema.ts';
import { authFields } from './auth-fields.ts';
import { categoryFields } from './category-fields.ts';
import type { Context } from './context.ts';
import { deviceFields } from './device-fields.ts';
import { buildEntities, type Entities, type Fields } from './entities.ts';
import { permissions } from './permissions.ts';
import { pingFields } from './ping-fields.ts';
import { ruleFields } from './rule-fields.ts';
import { scopedListField } from './scoped.ts';
import { summaryFields } from './summaries.ts';

/**
 * The read side: drizzle-graphql's generated list queries, each rebuilt so the
 * caller can only ever see their own rows.
 *
 * Activities carry no userId — ownership runs through the owning device, so
 * their fence is a subquery rather than a column comparison.
 */
function listQueries(entities: Entities): Fields {
  const ownDeviceIds = (ctx: Context & { userId: string }) =>
    ctx.db.select({ id: devices.id }).from(devices).where(eq(devices.userId, ctx.userId));

  return {
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
  };
}

/**
 * Assembles the executable schema from the domain modules beside this file,
 * with CASL permissions applied over the whole thing.
 *
 * What's picked here is what exists: the generated CRUD for auth tables and
 * raw device mutations is deliberately left out. Auth is GraphQL too
 * (signUp/signIn/signOut via the injected gateway) — the server mounts no
 * better-auth REST routes.
 *
 * Field order is the printed SDL's order, and the SDL is a committed artifact,
 * so reordering these spreads shows up as codegen churn in every consumer.
 */
export function createSchema(db: Db, auth: AuthGateway) {
  const entities = buildEntities(db);

  const query = new GraphQLObjectType({
    name: 'Query',
    fields: {
      ...listQueries(entities),
      ...summaryFields(db),
      me: {
        type: GraphQLString,
        resolve: (_source, _args, ctx: Context) => ctx.userId ?? null,
      },
    },
  });

  const mutation = new GraphQLObjectType({
    name: 'Mutation',
    fields: {
      ...authFields(auth),
      ...deviceFields(db, auth, entities),
      ...categoryFields(db, entities),
      ...ruleFields(db, entities),
      ...pingFields(db, entities),
    },
  });

  return applyPermissions(new GraphQLSchema({ query, mutation }), permissions);
}
