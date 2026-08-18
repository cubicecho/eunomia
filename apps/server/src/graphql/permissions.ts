import { accept, type PermissionsMap } from '@vantreeseba/graphql-casl';

// Placeholder permissions map. Once the activity data model lands and codegen
// produces `Resolvers`/`ResolversTypes`, replace `any` with those types and
// switch to real CASL abilities (createGraphQLAbility/createCan) scoping every
// subject to the requesting user.
// biome-ignore lint/suspicious/noExplicitAny: typed Resolvers arrive with codegen
export const permissions: PermissionsMap<any> = {
  Query: {
    devices: accept,
    activities: accept,
    categories: accept,
    categoryRules: accept,
    me: accept,
  },
  Mutation: {
    signUp: accept,
    signIn: accept,
    signOut: accept,
    registerDevice: accept,
    recordPing: accept,
    createCategory: accept,
    deleteCategory: accept,
    assignActivity: accept,
    createCategoryRule: accept,
    deleteCategoryRule: accept,
    applyCategoryRules: accept,
    // No wildcard deny here: graphql-middleware validates every key against the
    // schema, and unexposed fields simply don't exist (createSchema assembles
    // only what's picked). New fields must get an explicit rule when added.
  },
};
