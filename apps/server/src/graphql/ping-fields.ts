import { eq } from 'drizzle-orm';
import { GraphQLInt, GraphQLNonNull, GraphQLString } from 'graphql';
import { extractContext, loadContextRules } from '../activity/context.ts';
import { foldPing } from '../activity/fold.ts';
import { applyRules, loadRules } from '../activity/rules.ts';
import type { Db } from '../db/client.ts';
import { devices } from '../db/schema.ts';
import { badInput } from '../errors.ts';
import type { Context } from './context.ts';
import type { Entities, Fields } from './entities.ts';
import { requireOwned, requireUser } from './guards.ts';

// The one field the agents call continuously. Everything it does — liveness,
// context extraction, folding, categorization — happens per ping, so keeping
// it cheap matters more here than anywhere else in the schema.

/** How stale a device's lastSeenAt may get before a ping refreshes it. */
const LAST_SEEN_THROTTLE_MS = 60_000;

export function pingFields(db: Db, entities: Entities): Fields {
  return {
    recordPing: {
      // Nullable: idle pings and pings with no detectable app touch nothing.
      type: entities.types.Activities!,
      args: {
        // Optional: a device API key already identifies the device; sessions
        // (or keys acting on another owned device) can pass it explicitly.
        deviceId: { type: GraphQLString },
        capturedAt: { type: new GraphQLNonNull(GraphQLString) },
        app: { type: GraphQLString },
        title: { type: GraphQLString },
        // Agent-supplied sub-app division (browser hostname). When absent, the
        // user's context rules extract one from the title instead.
        context: { type: GraphQLString },
        idleSeconds: { type: new GraphQLNonNull(GraphQLInt) },
      },
      resolve: async (
        _source,
        args: {
          deviceId?: string | null;
          capturedAt: string;
          app?: string | null;
          title?: string | null;
          context?: string | null;
          idleSeconds: number;
        },
        ctx: Context,
      ) => {
        const userId = requireUser(ctx);
        const deviceId = args.deviceId ?? ctx.deviceId;
        if (!deviceId) throw badInput('No device: pass deviceId or use a device API key');
        const device = await requireOwned(db, devices, deviceId, userId, 'Unknown device');
        const capturedAt = new Date(args.capturedAt);
        if (Number.isNaN(capturedAt.getTime())) throw badInput('Invalid capturedAt');
        // Liveness marker for the dashboard. Receipt time, not capturedAt: a
        // retroactive mobile sync means the agent is alive NOW. Throttled —
        // within one batched upload only the first ping writes.
        const now = new Date();
        if (
          !device.lastSeenAt ||
          now.getTime() - device.lastSeenAt.getTime() > LAST_SEEN_THROTTLE_MS
        ) {
          await db.update(devices).set({ lastSeenAt: now }).where(eq(devices.id, device.id));
        }
        const context =
          args.context ??
          extractContext(
            await loadContextRules(db, device.userId),
            args.app ?? null,
            args.title ?? null,
          );
        const activity = await foldPing(db, device.id, {
          capturedAt,
          app: args.app ?? null,
          title: args.title ?? null,
          context,
          idleSeconds: args.idleSeconds,
        });
        if (!activity) return null;
        // Lazy auto-categorization: every ping re-evaluates the touched row, so
        // new rows, title churn, and rule changes all converge here.
        return applyRules(db, await loadRules(db, device.userId), activity);
      },
    },
  };
}
