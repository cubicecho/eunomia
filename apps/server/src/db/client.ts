import { drizzle } from 'drizzle-orm/node-postgres';
import type { PgAsyncDatabase } from 'drizzle-orm/pg-core';
import * as schema from './schema.ts';

export function createDb(
  connectionString = process.env.DATABASE_URL ??
    'postgres://eunomia:eunomia@localhost:5432/eunomia',
  timeZone = process.env.TZ,
) {
  return drizzle({
    connection: {
      connectionString,
      // Day boundaries (summaries.day, categorySummary) come from the session
      // time zone. node-postgres never forwards TZ itself, so without this
      // every "day" splits at UTC midnight. Set TZ to the user's zone BEFORE
      // real data accrues — rolled summaries store the day as text and won't
      // re-bucket.
      ...(timeZone ? { options: `-c TimeZone=${timeZone}` } : {}),
    },
    relations: schema.relations,
  });
}

// Driver-agnostic db type (node-postgres in prod, PGlite in tests) — both
// drivers extend PgAsyncDatabase over the same relations config.
export type Db = PgAsyncDatabase<any, typeof schema.relations>;
