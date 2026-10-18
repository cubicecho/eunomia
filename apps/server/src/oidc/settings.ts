import { and, eq, sql } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { oidcSettings, user } from '../db/schema.ts';
import { type OidcClientAuth, type OidcConfig, oidcConfigFromEnv } from './config.ts';

// Where the provider sign-in uses comes from, and who may change it. The
// environment (OIDC_ISSUER) wins over a pairing in the `oidc_settings` row, so
// a deployment that pins its provider can't be re-paired from the dashboard.

/** Where the provider in use came from. The GraphQL enum `SsoSource` has the same values. */
export type SsoSource = 'ENV' | 'PAIRED' | 'NONE';

/** The `oidc_settings` row, as pairing writes it. */
export interface PairedOidc {
  issuer: string;
  clientId: string;
  clientSecret: string | null;
  clientAuth: OidcClientAuth;
  name: string;
  /** RFC 7592: the credential that deletes the client at the provider. */
  registrationAccessToken: string | null;
  registrationClientUri: string | null;
}

export async function readPairedOidc(db: Db): Promise<PairedOidc | null> {
  const [row] = await db.select().from(oidcSettings).limit(1);
  if (!row) return null;
  return {
    issuer: row.issuer,
    clientId: row.clientId,
    clientSecret: row.clientSecret,
    clientAuth:
      row.clientAuth === 'client_secret_post' ? 'client_secret_post' : 'client_secret_basic',
    name: row.name,
    registrationAccessToken: row.registrationAccessToken,
    registrationClientUri: row.registrationClientUri,
  };
}

/** Saves a pairing, replacing any before it. */
export async function savePairedOidc(db: Db, paired: PairedOidc): Promise<void> {
  await db
    .insert(oidcSettings)
    .values(paired)
    .onConflictDoUpdate({ target: oidcSettings.id, set: { ...paired, updatedAt: new Date() } });
}

export async function clearPairedOidc(db: Db): Promise<void> {
  await db.delete(oidcSettings);
}

/** The environment's provider when OIDC_ISSUER is set, otherwise the pairing, otherwise none. */
export async function effectiveOidc(
  db: Db,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ config: OidcConfig | null; source: SsoSource }> {
  const fromEnv = oidcConfigFromEnv(env);
  if (fromEnv) return { config: fromEnv, source: 'ENV' };
  const paired = await readPairedOidc(db);
  if (!paired) return { config: null, source: 'NONE' };
  return {
    config: {
      issuer: paired.issuer,
      clientId: paired.clientId,
      clientSecret: paired.clientSecret ?? undefined,
      clientAuth: paired.clientAuth,
      name: paired.name,
    },
    source: 'PAIRED',
  };
}

// --- the admin ---
// Whoever sets an instance up is its first account, so that account becomes
// the admin and nobody is asked to edit a database row.

export async function isAdmin(db: Db, userId: string): Promise<boolean> {
  const [row] = await db.select({ isAdmin: user.isAdmin }).from(user).where(eq(user.id, userId));
  return row?.isAdmin === true;
}

/**
 * Makes `userId` the admin when the instance has none. One statement, so two
 * first sign-ins at once can't both claim it. Run on every account better-auth
 * creates, and after an account is deleted (on the oldest one left), so an
 * instance whose admin deleted themselves isn't left with nobody to pair.
 */
export async function claimFirstAdmin(db: Db, userId: string): Promise<void> {
  await db
    .update(user)
    .set({ isAdmin: true })
    .where(and(eq(user.id, userId), sql`not exists (select 1 from "user" where is_admin)`));
}

/** Hands the admin role to the oldest account when nobody holds it. */
export async function ensureAdmin(db: Db): Promise<void> {
  const [oldest] = await db
    .select({ id: user.id })
    .from(user)
    .orderBy(user.createdAt, user.id)
    .limit(1);
  if (oldest) await claimFirstAdmin(db, oldest.id);
}

export async function hasUsers(db: Db): Promise<boolean> {
  const [row] = await db.select({ id: user.id }).from(user).limit(1);
  return row !== undefined;
}
