import { sql } from 'drizzle-orm';
import { assertObjectType } from 'graphql';
import { describe, expect, it } from 'vitest';
import { permissions } from '../src/graphql/permissions.ts';
import { createSchema } from '../src/graphql/schema.ts';
import { stubAuthGateway } from './helpers/stub-auth.ts';
import { createTestDb } from './helpers/test-db.ts';

describe('graphql schema', () => {
  it('exposes exactly the selected fields', () => {
    const db = createTestDb();
    // drizzle-graphql only inspects the drizzle schema, so the PGlite db works
    // for schema-shape assertions without any tables existing.
    const schema = createSchema(db as never, stubAuthGateway());

    expect(Object.keys(schema.getQueryType()?.getFields() ?? {}).sort()).toEqual([
      'activities',
      'apiKeys',
      'appSummary',
      'categories',
      'categoryRules',
      'categorySummary',
      'contextRules',
      'deviceSummary',
      'devices',
      'me',
      'mergeRules',
    ]);
    expect(Object.keys(schema.getMutationType()?.getFields() ?? {}).sort()).toEqual([
      'applyCategoryRules',
      'applyMergeRules',
      'assignActivity',
      'createApiKey',
      'createCategory',
      'createCategoryRule',
      'createContextRule',
      'createMergeRule',
      'deleteCategory',
      'deleteCategoryRule',
      'deleteContextRule',
      'deleteDevice',
      'deleteMergeRule',
      'mergeDevice',
      'recordPing',
      'recordPings',
      'registerDevice',
      'renameApiKey',
      'renameDevice',
      'requestMagicLink',
      'revokeApiKey',
      'rotateDeviceKey',
      'sessionFromDeviceKey',
      'signIn',
      'signOut',
      'signUp',
      'updateCategoryRule',
      'updateContextRule',
      'verifyMagicLink',
    ]);
  });

  it('keeps the auth tables out of the graph entirely', () => {
    // `user` is excluded from generation, so there is no User type to reach
    // and no `Devices.user` field to reach it through — an email address is
    // not one hop from a device row, for any caller.
    const schema = createSchema(createTestDb() as never, stubAuthGateway());

    expect(schema.getType('User')).toBeUndefined();
    expect(Object.keys(assertObjectType(schema.getType('Devices')).getFields()).sort()).toEqual([
      'activities',
      'createdAt',
      'cursor',
      'id',
      'lastSeenAt',
      'name',
      'platform',
      'summaries',
      'userId',
    ]);
  });

  it('gives every exposed field an explicit permission rule', () => {
    // The rule that keeps this project honest: adding a field to the schema
    // without adding a rule for it silently ships an unauthenticated mutation.
    // graphql-middleware only validates the rules it was given against the
    // schema — it has nothing to say about a field nobody wrote a rule for.
    //
    // permissions.ts is typed against the field maps createSchema assembles,
    // so this normally fails at compile time first. This asserts it of the
    // built schema, which is the thing that actually serves requests.
    //
    // A new field belongs in permissions.ts even when the answer is `accept`:
    // "public on purpose" and "nobody thought about it" should not look the
    // same in the source.
    const schema = createSchema(createTestDb() as never, stubAuthGateway());
    // The '*' entry is the backstop under the named rules, not a field — a
    // field that reached the schema without a rule is denied by it rather than
    // served, and this assertion is what says no field is relying on that.
    const covered = (type: 'Query' | 'Mutation') =>
      Object.keys(permissions[type] as Record<string, unknown>)
        .filter((field) => field !== '*')
        .sort();

    expect(Object.keys(schema.getQueryType()?.getFields() ?? {}).sort()).toEqual(covered('Query'));
    expect(Object.keys(schema.getMutationType()?.getFields() ?? {}).sort()).toEqual(
      covered('Mutation'),
    );
  });
});

describe('pglite', () => {
  it('answers queries', async () => {
    const db = createTestDb();
    const result = await db.execute(sql`select 1 as one`);
    expect(result.rows).toEqual([{ one: 1 }]);
  });
});
