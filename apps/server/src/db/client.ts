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
      // The session time zone is the default day boundary: a user who hasn't
      // chosen a zone of their own (user.timeZone, rollup.ts ownerZone) has
      // their days split at its midnight. node-postgres never forwards TZ
      // itself, so without this that default is UTC.
      ...(timeZone ? { options: `-c TimeZone=${timeZone}` } : {}),
    },
    relations: schema.relations,
  });
}

// Driver-agnostic db type (node-postgres in prod, PGlite in tests) — both
// drivers extend PgAsyncDatabase over the same relations config.
// biome-ignore lint/suspicious/noExplicitAny: the driver's own query-result generic — naming either driver here is what would make this type wrong
export type Db = PgAsyncDatabase<any, typeof schema.relations>;
