import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { Db } from './db/client.ts';
import { instanceSecrets } from './db/schema.ts';

// The session-signing secret, for an install that didn't set
// BETTER_AUTH_SECRET: made once, on the first boot, and kept in the database
// so sessions survive restarts and every instance on that database agrees.
//
// What the startup check guards against is a *known* secret (unset used to be
// one, since better-auth then falls back to a built-in default). A random one
// stored next to the sessions it signs is not known: anyone who can read it
// can already read the session table.

const SESSION_SECRET = 'better_auth_secret';

/** The stored secret, made on first call. Safe against two instances racing on one database. */
export async function storedSessionSecret(db: Db): Promise<{ secret: string; created: boolean }> {
  const candidate = randomBytes(32).toString('base64');
  const inserted = await db
    .insert(instanceSecrets)
    .values({ name: SESSION_SECRET, value: candidate })
    .onConflictDoNothing()
    .returning({ value: instanceSecrets.value });
  if (inserted.length > 0) return { secret: candidate, created: true };
  const [row] = await db
    .select({ value: instanceSecrets.value })
    .from(instanceSecrets)
    .where(eq(instanceSecrets.name, SESSION_SECRET));
  if (!row) throw new Error('The stored session secret vanished while it was being read');
  return { secret: row.value, created: false };
}
