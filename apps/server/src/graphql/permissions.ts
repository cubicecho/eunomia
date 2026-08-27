import { accept, type Rule } from '@vantreeseba/graphql-casl';
import { unauthenticated } from '../errors.ts';
import type { Context } from './context.ts';
// Type-only, so this doesn't make a cycle at runtime: schema.ts imports the
// permissions below, and their type is the shape of what it exposes.
import type { mutationFields, queryFields } from './schema.ts';

/**
 * Passes only when the request carries an identity (session bearer token or
 * device API key). Row-level scoping is NOT done here — graphql-middleware
 * gates fields but can't rewrite queries, so ownership fences live in the
 * resolvers themselves (scopedListField for generated list queries, explicit
 * owner checks in the domain mutations). This layer guarantees no protected
 * field ever executes anonymously, even if a resolver forgets its own check.
 */
const authenticated: Rule = (resolve, parent, args, context: Context, info) => {
  if (!context.userId) return Promise.reject(unauthenticated());
  return resolve(parent, args, context, info);
};

/**
 * Passes only for device API keys (deviceId is set solely on x-api-key
 * requests). Keeps session bearers from minting further sessions.
 */
const deviceAuthenticated: Rule = (resolve, parent, args, context: Context, info) => {
  if (!context.userId || !context.deviceId) return Promise.reject(unauthenticated());
  return resolve(parent, args, context, info);
};

/**
 * A rule for every exposed field, and only for fields that exist. Both halves
 * matter: a field with no rule is an unauthenticated one, and a rule for a
 * field that was renamed away guards nothing while looking like it does.
 * `PermissionsMap` alone can't say this — its keys are all optional — so the
 * shape is spelled out here against what createSchema actually assembles.
 */
type SchemaPermissions = {
  Query: Record<keyof ReturnType<typeof queryFields>, Rule>;
  Mutation: Record<keyof ReturnType<typeof mutationFields>, Rule>;
};

export const permissions = {
  Query: {
    devices: authenticated,
    activities: authenticated,
    categories: authenticated,
    categoryRules: authenticated,
    contextRules: authenticated,
    mergeRules: authenticated,
    categorySummary: authenticated,
    appSummary: authenticated,
    deviceSummary: authenticated,
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
    // Desktop dashboard hand-off: only a device key may trade itself for a session.
    sessionFromDeviceKey: deviceAuthenticated,
    registerDevice: authenticated,
    renameDevice: authenticated,
    rotateDeviceKey: authenticated,
    mergeDevice: authenticated,
    deleteDevice: authenticated,
    recordPing: authenticated,
    recordPings: authenticated,
    createCategory: authenticated,
    deleteCategory: authenticated,
    assignActivity: authenticated,
    createCategoryRule: authenticated,
    updateCategoryRule: authenticated,
    deleteCategoryRule: authenticated,
    applyCategoryRules: authenticated,
    createContextRule: authenticated,
    updateContextRule: authenticated,
    deleteContextRule: authenticated,
    createMergeRule: authenticated,
    deleteMergeRule: authenticated,
    applyMergeRules: authenticated,
    // No wildcard deny here: graphql-middleware validates every key against the
    // schema, and unexposed fields simply don't exist (createSchema assembles
    // only what's picked). New fields must get an explicit rule when added.
  },
} satisfies SchemaPermissions;
