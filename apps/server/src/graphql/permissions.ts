import { accept, deny, type PermissionsMap, type Rule } from '@vantreeseba/graphql-casl';
import { unauthenticated } from '../errors.ts';
import type { MutationResolvers, QueryResolvers } from '../gql/resolvers.ts';
import type { Context } from './context.ts';

/**
 * Passes only when the request carries an identity (session bearer token or
 * device API key). Row-level scoping is NOT done here — graphql-middleware
 * gates fields but can't rewrite queries, so ownership fences live below: the
 * generated reads are fenced at build time (scope.ts) and the domain mutations
 * check ownership themselves. This layer guarantees no protected field ever
 * executes anonymously, even if a resolver forgets its own check.
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
 * The schema as the permissions map is typed against: field names come from
 * codegen over the schema itself (src/gql/resolvers.ts), so a field renamed in
 * domain.graphql is a compile error here and in its resolver at once.
 */
export type Resolvers = {
  Query: QueryResolvers;
  Mutation: MutationResolvers;
};

/**
 * A rule for every exposed field, and only for fields that exist. Both halves
 * matter: a field with no rule is an unauthenticated one, and a rule for a
 * field that was renamed away guards nothing while looking like it does.
 * `PermissionsMap` alone can't say this — its keys are all optional — so the
 * exhaustive shape is spelled out here on top of it.
 */
type SchemaPermissions = PermissionsMap<Resolvers> & {
  Query: Record<keyof QueryResolvers | '*', Rule>;
  Mutation: Record<keyof MutationResolvers | '*', Rule>;
};

export const permissions = {
  Query: {
    // The runtime half of the exhaustiveness above: a named field wins over
    // the wildcard, so a field added without a rule is refused rather than
    // served openly. The type says it can't happen; this says what happens if
    // it does anyway — a rule map built from stale types, say.
    '*': deny,
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
    '*': deny,
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
  },
} satisfies SchemaPermissions;
