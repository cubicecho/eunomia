import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
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
      'recordPing',
      'registerDevice',
      'renameDevice',
      'requestMagicLink',
      'sessionFromDeviceKey',
      'signIn',
      'signOut',
      'signUp',
      'verifyMagicLink',
    ]);
  });
});

describe('pglite', () => {
  it('answers queries', async () => {
    const db = createTestDb();
    const result = await db.execute(sql`select 1 as one`);
    expect(result.rows).toEqual([{ one: 1 }]);
  });
});
