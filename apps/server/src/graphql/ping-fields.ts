import type { MutationResolvers, PingInput } from '@eunomia/gql/resolvers';
import { eq } from 'drizzle-orm';
import { ingestPings } from '../activity/ingest.ts';
import type { RawPing } from '../activity/ping-log.ts';
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

/**
 * How far ahead of the server a device's clock may run before its pings are
 * pulled back to receipt time. Generous enough to cover ordinary NTP drift.
 */
const MAX_CLOCK_SKEW_MS = 2 * 60_000;

/**
 * Parses every capturedAt up front, so a malformed ping rejects nothing halfway,
 * and clamps any that claim to be from the future.
 *
 * A future timestamp doesn't just misplace one ping — it wedges the device.
 * The fold writes it to lastActiveAt, and from then on every correctly-dated
 * ping reads as out-of-order and accrues nothing, while the poisoned row never
 * auto-closes because its staleness is negative. The device silently records no
 * time at all until the wall clock catches up, which for a Windows machine that
 * booted against a mis-set RTC (dual boot, dead CMOS battery, a VM resumed from
 * a snapshot) can be hours. Clamping costs at most a couple of minutes of
 * placement; not clamping costs everything until the skew expires.
 */
function parseCapturedAt(pings: PingInput[]): Date[] {
  const receivedAt = Date.now();
  let clamped = 0;
  const parsed = pings.map((ping) => {
    const capturedAt = new Date(ping.capturedAt);
    if (Number.isNaN(capturedAt.getTime())) throw badInput('Invalid capturedAt');
    if (capturedAt.getTime() > receivedAt + MAX_CLOCK_SKEW_MS) {
      clamped++;
      return new Date(receivedAt);
    }
    return capturedAt;
  });
  if (clamped > 0) {
    console.warn(`clamped ${clamped} ping(s) dated after receipt — the device's clock is ahead`);
  }
  return parsed;
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
 * The raw pings a batch stores: the agent's fields, with capturedAt parsed and
 * clamped. Recording, folding and categorizing happen in ingestPings.
 */
function toRawPings(pings: PingInput[], capturedAts: Date[]): RawPing[] {
  return pings.map((ping, i) => ({
    capturedAt: capturedAts[i]!,
    app: ping.app ?? null,
    title: ping.title ?? null,
    context: ping.context ?? null,
    idleSeconds: ping.idleSeconds,
  }));
}

export function pingFields(db: Db) {
  return {
    // Nullable: idle pings and pings with no detectable app touch nothing.
    recordPing: async (_source, args, ctx) => {
      const device = await resolveDevice(db, ctx, args.deviceId);
      const [capturedAt] = parseCapturedAt([args]);
      await touchLastSeen(db, device);
      const [activity] = await ingestPings(db, device, toRawPings([args], [capturedAt!]));
      return activity ?? null;
    },
    // The agents' upload path: one round trip, one transaction, one fold lock.
    // Returns how many pings accrued to an activity — the rest were idle or
    // had no detectable app, which is a legitimate whole batch and not a
    // failure. All-or-nothing, and a retried batch's pings are recognised as
    // already logged, so a retry can't double-count.
    recordPings: async (_source, args, ctx) => {
      const device = await resolveDevice(db, ctx, args.deviceId);
      if (args.pings.length > MAX_BATCH) {
        throw badInput(`Too many pings in one batch (max ${MAX_BATCH})`);
      }
      const capturedAts = parseCapturedAt(args.pings);
      if (args.pings.length === 0) return 0;
      await touchLastSeen(db, device);
      const touched = await ingestPings(db, device, toRawPings(args.pings, capturedAts));
      return touched.filter((activity) => activity !== null).length;
    },
  } satisfies MutationResolvers;
}
