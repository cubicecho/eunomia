import { sql } from 'drizzle-orm';
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
      'appSummary',
      'categories',
      'categoryRules',
      'categorySummary',
      'contextRules',
      'devices',
      'me',
    ]);
    expect(Object.keys(schema.getMutationType()?.getFields() ?? {}).sort()).toEqual([
      'applyCategoryRules',
      'assignActivity',
      'createCategory',
      'createCategoryRule',
      'createContextRule',
      'deleteCategory',
      'deleteCategoryRule',
      'deleteContextRule',
      'deleteDevice',
      'mergeDevice',
      'recordPing',
      'recordPings',
      'registerDevice',
      'renameDevice',
      'requestMagicLink',
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

  it('gives every exposed field an explicit permission rule', () => {
    // The rule that keeps this project honest: adding a field to the schema
    // without adding a rule for it silently ships an unauthenticated
    // mutation. graphql-middleware only validates the rules it was given
    // against the schema — it has nothing to say about a field nobody wrote a
    // rule for, so this is the check that says it.
    //
    // A new field belongs in permissions.ts even when the answer is `accept`:
    // "public on purpose" and "nobody thought about it" should not look the
    // same in the source.
    const schema = createSchema(createTestDb() as never, stubAuthGateway());
    const covered = (type: 'Query' | 'Mutation') =>
      Object.keys(permissions[type] as Record<string, unknown>).sort();

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
