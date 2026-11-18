import type { MutationResolvers } from '@eunomia/gql/resolvers';
import { and, eq, inArray } from 'drizzle-orm';
import { mergeDeviceHistory } from '../activity/merge.ts';
import { replayDevice } from '../activity/replay.ts';
import type { Db } from '../db/client.ts';
import { devices } from '../db/schema.ts';
import { badInput, notFound } from '../errors.ts';
import { requireOwned, requireUser } from './guards.ts';

// Device lifecycle: register, rename, merge, delete. The generated device CRUD
// is deliberately not exposed — every one of these does something to the
// history that a raw insert/update wouldn't.
//
// A device holds no credential of its own: its agent signs in as its person
// (a provider access token, or a session from a sign-in link) and names the
// device on every upload. Revoking an agent is the provider's (or signing the
// session out); deleting the device here refuses its uploads from then on.

export function deviceFields(db: Db) {
  return {
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
      return row!;
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
    // Folds one device into another and retires it — the fix for the same
    // machine registered twice. Everything the source recorded becomes the
    // target's, so the history survives what deleteDevice would have
    // cascaded away. Merge the duplicate INTO the device whose agent is
    // still running: the source's agent is refused from then on.
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
    replayDevice: async (_source, args, ctx) => {
      const userId = requireUser(ctx);
      const device = await requireOwned(db, devices, args.id, userId, 'Unknown device');
      const from = args.from == null ? undefined : new Date(args.from);
      if (from && Number.isNaN(from.getTime())) throw badInput('Invalid from');
      const result = await replayDevice(db, device.id, { from });
      return { ...result, from: result.from?.toISOString() ?? null };
    },
    // True when the device was deleted. Its activities cascade away, and the
    // agent's next upload naming it gets rejected.
    deleteDevice: async (_source, args, ctx) => {
      const userId = requireUser(ctx);
      const device = await requireOwned(db, devices, args.id, userId, 'Unknown device');
      await db.delete(devices).where(eq(devices.id, device.id));
      return true;
    },
  } satisfies MutationResolvers;
}
