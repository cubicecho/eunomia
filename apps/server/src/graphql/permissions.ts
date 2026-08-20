import { accept, type PermissionsMap, type Rule } from '@vantreeseba/graphql-casl';
import { GraphQLError } from 'graphql';
import type { Context } from './context.ts';

/**
 * Passes only when the request carries an identity (session bearer token or
 * device API key). Row-level scoping is NOT done here — graphql-middleware
 * gates fields but can't rewrite queries, so ownership fences live in the
 * resolvers themselves (scopedListField for generated list queries, explicit
 * owner checks in the domain mutations). This layer guarantees no protected
 * field ever executes anonymously, even if a resolver forgets its own check.
 */
const authenticated: Rule = (resolve, parent, args, context: Context, info) => {
  if (!context.userId) {
    return Promise.reject(new GraphQLError('Not authenticated'));
  }
  return resolve(parent, args, context, info);
};

// biome-ignore lint/suspicious/noExplicitAny: typed Resolvers arrive with codegen
export const permissions: PermissionsMap<any> = {
  Query: {
    devices: authenticated,
    activities: authenticated,
    categories: authenticated,
    categoryRules: authenticated,
    contextRules: authenticated,
    categorySummary: authenticated,
    appSummary: authenticated,
    // Public by design: returns the caller's id or null.
    me: accept,
  },
  Mutation: {
    signUp: accept,
    signIn: accept,
    // Public: these ARE the login flow.
    requestMagicLink: accept,
    verifyMagicLink: accept,
    // Public: reports false for sessionless calls rather than erroring.
    signOut: accept,
    registerDevice: authenticated,
    renameDevice: authenticated,
    deleteDevice: authenticated,
    recordPing: authenticated,
    createCategory: authenticated,
    deleteCategory: authenticated,
    assignActivity: authenticated,
    createCategoryRule: authenticated,
    deleteCategoryRule: authenticated,
    applyCategoryRules: authenticated,
    createContextRule: authenticated,
    deleteContextRule: authenticated,
    // No wildcard deny here: graphql-middleware validates every key against the
    // schema, and unexposed fields simply don't exist (createSchema assembles
    // only what's picked). New fields must get an explicit rule when added.
  },
};
