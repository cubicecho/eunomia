import { PGlite } from '@electric-sql/pglite';
import { pushSchema } from 'drizzle-kit/api-postgres';
import { drizzle } from 'drizzle-orm/pglite';
import * as schema from '../../src/db/schema.ts';

/**
 * In-memory Postgres (PGlite) drizzle instance for tests — real Postgres
 * semantics, no container. `createTestDb` gives a bare instance (no tables);
 * `createMigratedTestDb` pushes the full schema first.
 */
export function createTestDb() {
  const client = new PGlite();
  return drizzle({ client, relations: schema.relations });
}

export async function createMigratedTestDb() {
  const db = createTestDb();
  const { apply } = await pushSchema(schema, db);
  await apply();
  return db;
}

export type TestDb = ReturnType<typeof createTestDb>;
