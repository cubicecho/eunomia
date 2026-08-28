import { and, eq, inArray } from 'drizzle-orm';
import { mergeDeviceHistory } from '../activity/merge.ts';
import type { AuthGateway } from '../auth.ts';
import type { Db } from '../db/client.ts';
import { apikey, devices } from '../db/schema.ts';
import { badInput, notFound } from '../errors.ts';
import type { MutationResolvers } from '../gql/resolvers.ts';
import { requireOwned, requireUser } from './guards.ts';

// Device lifecycle: register, rename, re-key, merge, delete. The generated
// device CRUD is deliberately not exposed — every one of these does something
// to the API keys or the history that a raw insert/update wouldn't.

/**
 * The deviceId a stored apikey row was minted for, or null. The better-auth
 * plugin JSON-serializes the metadata column (double-encoded in some
 * versions), so tolerate both encodings and anything unparseable.
 */
function keyMetadataDeviceId(metadata: string | null): string | null {
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

/**
 * Deletes every stored key minted for a device. Only hashes are kept, so
 * dropping the rows is a full revocation.
 */
async function revokeDeviceKeys(db: Db, userId: string, deviceId: string): Promise<void> {
  // Keys are matched by the deviceId minted into their metadata. The plugin
  // JSON-serializes that column, so match in JS rather than guessing its exact
  // encoding in SQL.
  const keys = await db
    .select({ id: apikey.id, metadata: apikey.metadata })
    .from(apikey)
    .where(eq(apikey.referenceId, userId));
  const stale = keys
    .filter((key) => keyMetadataDeviceId(key.metadata) === deviceId)
    .map((key) => key.id);
  if (stale.length > 0) await db.delete(apikey).where(inArray(apikey.id, stale));
}

export function deviceFields(db: Db, auth: AuthGateway) {
  return {
    // The plaintext API key exists only in this response (the server stores a
    // hash), so DeviceRegistration carries it exactly once.
    registerDevice: async (_source, args, ctx) => {
      const userId = requireUser(ctx);
      const [row] = await db
        .insert(devices)
        .values({
          id: crypto.randomUUID(),
          userId,
          name: args.name,
          platform: args.platform as 'windows' | 'macos' | 'linux' | 'android',
        })
        .returning();
      const apiKey = await auth.mintDeviceKey({ userId, deviceId: row!.id, name: args.name });
      return { device: row!, apiKey };
    },
    renameDevice: async (_source, args, ctx) => {
      const userId = requireUser(ctx);
      const device = await requireOwned(db, devices, args.id, userId, 'Unknown device');
      const [updated] = await db
        .update(devices)
        .set({ name: args.name })
        .where(eq(devices.id, device.id))
        .returning();
      return updated!;
    },
    // A fresh API key for a device that already exists — how an agent
    // recovers from a revoked or lost key without re-registering, which
    // would strand its history on an orphaned device row. The old keys are
    // revoked here, so an agent still holding one stops uploading.
    rotateDeviceKey: async (_source, args, ctx) => {
      const userId = requireUser(ctx);
      const device = await requireOwned(db, devices, args.id, userId, 'Unknown device');
      await revokeDeviceKeys(db, userId, device.id);
      const apiKey = await auth.mintDeviceKey({
        userId,
        deviceId: device.id,
        name: device.name,
      });
      return { device, apiKey };
    },
    // Folds one device into another and retires it — the fix for the same
    // machine registered twice. Everything the source recorded becomes the
    // target's, so the history survives what deleteDevice would have
    // cascaded away. Merge the duplicate INTO the device whose agent is
    // still running: only the source's key is revoked.
    mergeDevice: async (_source, args, ctx) => {
      const userId = requireUser(ctx);
      if (args.id === args.intoId) throw badInput('Pick a different device to merge into');
      // Both in one query rather than two requireOwned calls: either both
      // are the caller's or neither answer is given.
      const owned = await db
        .select()
        .from(devices)
        .where(and(eq(devices.userId, userId), inArray(devices.id, [args.id, args.intoId])));
      const source = owned.find((device) => device.id === args.id);
      const target = owned.find((device) => device.id === args.intoId);
      if (!source || !target) throw notFound('Unknown device');

      await mergeDeviceHistory(db, source.id, target.id);
      await revokeDeviceKeys(db, userId, source.id);
      await db.delete(devices).where(eq(devices.id, source.id));

      // The merged device is as recently seen as the more recent of the two.
      const seen = [source.lastSeenAt, target.lastSeenAt].filter((at) => at !== null);
      const [updated] = await db
        .update(devices)
        .set({
          lastSeenAt:
            seen.length > 0 ? new Date(Math.max(...seen.map((at) => at.getTime()))) : null,
        })
        .where(eq(devices.id, target.id))
        .returning();
      return updated!;
    },
    // True when the device was deleted. Its activities cascade away, and its
    // API keys are revoked (only hashes are stored, so deleting the rows is a
    // full revocation) — the agent's next upload gets rejected.
    deleteDevice: async (_source, args, ctx) => {
      const userId = requireUser(ctx);
      const device = await requireOwned(db, devices, args.id, userId, 'Unknown device');
      await revokeDeviceKeys(db, userId, device.id);
      await db.delete(devices).where(eq(devices.id, device.id));
      return true;
    },
  } satisfies MutationResolvers;
}
