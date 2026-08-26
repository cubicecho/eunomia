import { PGlite } from '@electric-sql/pglite';
import { pushSchema } from 'drizzle-kit/api-postgres';
import { sql } from 'drizzle-orm';
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
  // Day boundaries follow the session zone (prod sets it from TZ — see
  // db/client.ts). PGlite would otherwise inherit the developer's machine
  // zone and make day-bucketing assertions machine-dependent; tests that care
  // about a non-UTC zone set their own with `set time zone`.
  await db.execute(sql`set time zone 'UTC'`);
  return db;
}

export type TestDb = ReturnType<typeof createTestDb>;
