import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createSchema } from '../src/graphql/schema.ts';
import { createTestDb } from './helpers/test-db.ts';

describe('graphql schema', () => {
  it('exposes exactly the selected fields', () => {
    const db = createTestDb();
    // drizzle-graphql only inspects the drizzle schema, so the PGlite db works
    // for schema-shape assertions without any tables existing.
    const schema = createSchema(db as never, {
      mintDeviceKey: async () => 'test-key',
      signUp: async () => ({ token: 't', userId: 'u' }),
      signIn: async () => ({ token: 't', userId: 'u' }),
      signOut: async () => true,
    });

    expect(Object.keys(schema.getQueryType()?.getFields() ?? {}).sort()).toEqual([
      'activities',
      'categories',
      'categoryRules',
      'categorySummary',
      'devices',
      'me',
    ]);
    expect(Object.keys(schema.getMutationType()?.getFields() ?? {}).sort()).toEqual([
      'applyCategoryRules',
      'assignActivity',
      'createCategory',
      'createCategoryRule',
      'deleteCategory',
      'deleteCategoryRule',
      'recordPing',
      'registerDevice',
      'signIn',
      'signOut',
      'signUp',
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
