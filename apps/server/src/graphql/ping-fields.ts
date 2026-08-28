import type { MutationResolvers, PingInput } from '@eunomia/gql/resolvers';
import { eq } from 'drizzle-orm';
import { type ContextRule, extractContext, loadContextRules } from '../activity/context.ts';
import { type Activity, foldPing, lockDevice } from '../activity/fold.ts';
import { loadMergeRules, type MergeRule, mergeEntry } from '../activity/merge-rules.ts';
import { applyRules, type CategoryRule, loadRules } from '../activity/rules.ts';
import type { Db } from '../db/client.ts';
import { devices } from '../db/schema.ts';
import { badInput } from '../errors.ts';
import type { Context } from './context.ts';
import { requireOwned, requireUser } from './guards.ts';

// The fields the agents call continuously. Everything they do — liveness,
// context extraction, folding, categorization — happens per ping, so keeping
// them cheap matters more here than anywhere else in the schema.

/** How stale a device's lastSeenAt may get before a ping refreshes it. */
const LAST_SEEN_THROTTLE_MS = 60_000;

/**
 * A batch bigger than this is rejected outright. The agent's own flush size is
 * well under it; the cap is here so one request can't hold the device's fold
 * lock for an unbounded stretch.
 */
const MAX_BATCH = 500;

type Device = typeof devices.$inferSelect;

/**
 * Resolves the device a ping batch belongs to, or throws.
 *
 * deviceId is optional because a device API key already identifies the device;
 * sessions (or keys acting on another owned device) pass it explicitly.
 */
async function resolveDevice(db: Db, ctx: Context, deviceId?: string | null): Promise<Device> {
  const userId = requireUser(ctx);
  const id = deviceId ?? ctx.deviceId;
  if (!id) throw badInput('No device: pass deviceId or use a device API key');
  return requireOwned(db, devices, id, userId, 'Unknown device');
}

/** Parses every capturedAt up front, so a malformed ping rejects nothing halfway. */
function parseCapturedAt(pings: PingInput[]): Date[] {
  return pings.map((ping) => {
    const capturedAt = new Date(ping.capturedAt);
    if (Number.isNaN(capturedAt.getTime())) throw badInput('Invalid capturedAt');
    return capturedAt;
  });
}

/**
 * Marks the device alive. Receipt time, not capturedAt: a retroactive mobile
 * sync means the agent is alive NOW. Throttled — within one batched upload
 * only the first write lands.
 */
async function touchLastSeen(db: Db, device: Device): Promise<void> {
  const now = new Date();
  if (device.lastSeenAt && now.getTime() - device.lastSeenAt.getTime() <= LAST_SEEN_THROTTLE_MS) {
    return;
  }
  await db.update(devices).set({ lastSeenAt: now }).where(eq(devices.id, device.id));
}

/**
 * Folds a batch of pings into the device's activities, in order, inside one
 * transaction holding the device's fold lock.
 *
 * The lock is what makes a retried upload safe: a batch either lands whole or
 * not at all, and no other upload from the same device interleaves with it.
 * The rules — both kinds — are loaded once for the batch rather than once per
 * ping, which is the difference between 3 queries and 101 for a 50-ping flush.
 *
 * Returns the activities the batch touched, in ping order, with nulls for the
 * pings that touched nothing (idle, or no detectable app).
 */
async function foldBatch(
  db: Db,
  device: Device,
  pings: PingInput[],
  capturedAts: Date[],
): Promise<(Activity | null)[]> {
  const [contextRules, categoryRules, mergeRules] = await Promise.all([
    loadContextRules(db, device.userId),
    loadRules(db, device.userId),
    loadMergeRules(db, device.userId),
  ]);
  return db.transaction(async (tx) => {
    await lockDevice(tx, device.id);
    const touched: (Activity | null)[] = [];
    for (const [i, ping] of pings.entries()) {
      touched.push(
        await foldOne(
          tx,
          device.id,
          ping,
          capturedAts[i]!,
          contextRules,
          categoryRules,
          mergeRules,
        ),
      );
    }
    return touched;
  });
}

async function foldOne(
  tx: Db,
  deviceId: string,
  ping: PingInput,
  capturedAt: Date,
  contextRules: ContextRule[],
  categoryRules: CategoryRule[],
  mergeRules: MergeRule[],
): Promise<Activity | null> {
  const context =
    ping.context ?? extractContext(contextRules, ping.app ?? null, ping.title ?? null);
  // Merges apply to the FINAL fold key, so after context extraction and to
  // both halves of it: the user merged what the dashboard showed them, which
  // is the (app, context) pair, not the raw app the agent reported.
  const entry = ping.app
    ? mergeEntry(mergeRules, { app: ping.app, context })
    : { app: null, context };
  const activity = await foldPing(tx, deviceId, {
    capturedAt,
    app: entry.app,
    title: ping.title ?? null,
    context: entry.context,
    idleSeconds: ping.idleSeconds,
  });
  if (!activity) return null;
  // Lazy auto-categorization: every ping re-evaluates the touched row, so new
  // rows, title churn, and rule changes all converge here.
  return applyRules(tx, categoryRules, activity);
}

export function pingFields(db: Db) {
  return {
    // Nullable: idle pings and pings with no detectable app touch nothing.
    recordPing: async (_source, args, ctx) => {
      const device = await resolveDevice(db, ctx, args.deviceId);
      const [capturedAt] = parseCapturedAt([args]);
      await touchLastSeen(db, device);
      const [activity] = await foldBatch(db, device, [args], [capturedAt!]);
      return activity ?? null;
    },
    // The agents' upload path: one round trip, one transaction, one fold lock.
    // Returns how many pings accrued to an activity — the rest were idle or
    // had no detectable app, which is a legitimate whole batch and not a
    // failure. All-or-nothing, so a retried batch can't double-count.
    recordPings: async (_source, args, ctx) => {
      const device = await resolveDevice(db, ctx, args.deviceId);
      if (args.pings.length > MAX_BATCH) {
        throw badInput(`Too many pings in one batch (max ${MAX_BATCH})`);
      }
      const capturedAts = parseCapturedAt(args.pings);
      if (args.pings.length === 0) return 0;
      await touchLastSeen(db, device);
      const touched = await foldBatch(db, device, args.pings, capturedAts);
      return touched.filter((activity) => activity !== null).length;
    },
  } satisfies MutationResolvers;
}
