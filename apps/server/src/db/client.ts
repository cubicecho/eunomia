import { drizzle } from 'drizzle-orm/node-postgres';
import type { PgAsyncDatabase } from 'drizzle-orm/pg-core';
import * as schema from './schema.ts';

export function createDb(
  connectionString = process.env.DATABASE_URL ??
    'postgres://eunomia:eunomia@localhost:5432/eunomia',
) {
  return drizzle({
    connection: connectionString,
    relations: schema.relations,
  });
}

// Driver-agnostic db type (node-postgres in prod, PGlite in tests) — both
// drivers extend PgAsyncDatabase over the same relations config.
export type Db = PgAsyncDatabase<any, typeof schema.relations>;
