import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import type { Db } from './db/client.ts';

/** This server build's version, from its package.json (`0.0.0` if unreadable). */
export const VERSION: string = readVersion();

export interface Health {
  ok: boolean;
  version: string;
  /** Why the check failed — omitted when healthy. */
  error?: string;
}

/**
 * The liveness probe behind GET /healthz. It round-trips to Postgres on
 * purpose: the failure worth catching (database gone, connections exhausted,
 * migrations mid-flight) still leaves the HTTP server answering happily, so a
 * check that only proves "the process is up" reports healthy through an
 * outage.
 */
export async function checkHealth(db: Db): Promise<Health> {
  try {
    await db.execute(sql`select 1`);
    return { ok: true, version: VERSION };
  } catch (error) {
    return { ok: false, version: VERSION, error: error instanceof Error ? error.message : 'error' };
  }
}

function readVersion(): string {
  try {
    const path = join(import.meta.dirname, '..', 'package.json');
    const pkg = JSON.parse(readFileSync(path, 'utf8')) as { version?: string };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}
