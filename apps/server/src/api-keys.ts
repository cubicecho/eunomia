import { and, eq, inArray } from 'drizzle-orm';
import type { Db } from './db/client.ts';
import { apikey } from './db/schema.ts';

/**
 * The `apikey` table, read the way this server keys it.
 *
 * better-auth mints and hashes the keys (src/auth.ts); everything here is the
 * other half — which key is what, and deleting the rows. Only hashes are
 * stored, so deleting a row IS the revocation; there is nothing to expire out
 * of a cache.
 *
 * Two kinds of key share the table, told apart by the metadata minted into
 * them:
 *
 * - **device keys** carry `{ deviceId }`. One per registered agent, issued by
 *   `registerDevice`/`rotateDeviceKey` and revoked with the device.
 * - **integration keys** carry no deviceId. Issued from the dashboard for
 *   anything else that talks to this server — an MCP client, a script — and
 *   managed only from a signed-in session (see permissions.ts).
 *
 * A key of either kind authenticates as its owner; the difference is that a
 * device key also *is* a device, so ingestion can omit deviceId and
 * `sessionFromDeviceKey` has something to hand the desktop dashboard.
 */

/** One row of the caller's key list. Never carries the key or its hash. */
export interface ApiKeyRow {
  id: string;
  name: string;
  /** First few plaintext characters, kept so the UI can tell two keys apart. */
  start: string | null;
  createdAt: Date;
  /** Last time the key authenticated a request; null until it is first used. */
  lastRequest: Date | null;
  expiresAt: Date | null;
  enabled: boolean;
}

/**
 * The deviceId a stored apikey row was minted for, or null for an integration
 * key. The better-auth plugin JSON-serializes the metadata column
 * (double-encoded in some versions), so tolerate both encodings and anything
 * unparseable.
 */
export function keyMetadataDeviceId(metadata: string | null): string | null {
  if (!metadata) return null;
  try {
    let parsed: unknown = JSON.parse(metadata);
    if (typeof parsed === 'string') parsed = JSON.parse(parsed);
    const deviceId = (parsed as Record<string, unknown> | null)?.deviceId;
    return typeof deviceId === 'string' ? deviceId : null;
  } catch {
    return null;
  }
}

/** Every key the user holds, both kinds, with the metadata still attached. */
async function ownKeys(db: Db, userId: string) {
  return db
    .select({
      id: apikey.id,
      name: apikey.name,
      start: apikey.start,
      createdAt: apikey.createdAt,
      lastRequest: apikey.lastRequest,
      expiresAt: apikey.expiresAt,
      enabled: apikey.enabled,
      metadata: apikey.metadata,
    })
    .from(apikey)
    .where(eq(apikey.referenceId, userId));
}

/**
 * The user's integration keys, newest first — device keys excluded, because
 * they belong to the Devices tab and revoking one there means retiring an
 * agent, not withdrawing an integration.
 *
 * The kind is decided in JS rather than in SQL: the plugin owns the metadata
 * column's encoding, and `keyMetadataDeviceId` already tolerates every version
 * of it.
 */
export async function listIntegrationKeys(db: Db, userId: string): Promise<ApiKeyRow[]> {
  const rows = await ownKeys(db, userId);
  return rows
    .filter((row) => keyMetadataDeviceId(row.metadata) === null)
    .map(({ metadata: _metadata, name, ...row }) => ({ ...row, name: name ?? 'unnamed' }))
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

/** One integration key the caller owns, or null. Device keys are not findable here. */
export async function findIntegrationKey(
  db: Db,
  userId: string,
  id: string,
): Promise<ApiKeyRow | null> {
  return (await listIntegrationKeys(db, userId)).find((row) => row.id === id) ?? null;
}

/**
 * Deletes one of the caller's keys. Ownership is part of the WHERE, so
 * "someone else's id" and "no such id" are the same non-event.
 */
export async function deleteKey(db: Db, userId: string, id: string): Promise<void> {
  await db.delete(apikey).where(and(eq(apikey.referenceId, userId), eq(apikey.id, id)));
}

/** Renames one of the caller's keys. */
export async function renameKey(db: Db, userId: string, id: string, name: string): Promise<void> {
  await db
    .update(apikey)
    .set({ name })
    .where(and(eq(apikey.referenceId, userId), eq(apikey.id, id)));
}

/**
 * Deletes every stored key minted for a device. Only hashes are kept, so
 * dropping the rows is a full revocation.
 */
export async function revokeDeviceKeys(db: Db, userId: string, deviceId: string): Promise<void> {
  const keys = await ownKeys(db, userId);
  const stale = keys
    .filter((key) => keyMetadataDeviceId(key.metadata) === deviceId)
    .map((key) => key.id);
  if (stale.length > 0) await db.delete(apikey).where(inArray(apikey.id, stale));
}
