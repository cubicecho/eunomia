import type { MutationResolvers, QueryResolvers } from '@eunomia/gql/resolvers';
import { eq, sql } from 'drizzle-orm';
import {
  deleteAccount,
  deleteRange,
  loadUserRetention,
  purgeApp,
  setUserRetention,
} from '../activity/deletion.ts';
import { retentionDays } from '../activity/rollup.ts';
import { loadUserTimeZone, setUserTimeZone } from '../activity/time-zone.ts';
import type { Db } from '../db/client.ts';
import { devices, user } from '../db/schema.ts';
import { badInput, notFound, unauthenticated } from '../errors.ts';
import { requireOwned, requireUser } from './guards.ts';

// The caller's own account: who they are, the settings the server keeps for
// them — the time zone their days split in, how long their raw history is
// kept, where they are in the getting-started checklist — and deleting what
// they no longer want kept.

/** `Me` for a user, or undefined when the row is gone. */
async function loadMe(db: Db, userId: string) {
  const zone = await loadUserTimeZone(db, userId);
  // Read per request rather than captured at boot: the server has already
  // refused to start on a bad value (startRollupTimer).
  const retention = await loadUserRetention(db, userId, retentionDays());
  const [account] = await db
    .select({
      email: user.email,
      onboardingDismissedAt: user.onboardingDismissedAt,
      privacyReviewedAt: user.privacyReviewedAt,
    })
    .from(user)
    .where(eq(user.id, userId));
  if (!zone || !retention || !account) return undefined;
  return {
    ...zone,
    ...retention,
    email: account.email,
    onboardingDismissed: account.onboardingDismissedAt !== null,
    privacyReviewed: account.privacyReviewedAt !== null,
  };
}

/** An ISO timestamp argument as a Date, or a thrown BAD_USER_INPUT. */
function instant(value: string, name: string): Date {
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) throw badInput(`Invalid ${name}`);
  return at;
}

export function userQueryFields(db: Db) {
  return {
    // Public: null for an anonymous request rather than an error, so a client
    // can ask "am I signed in?" without handling one. A key answers for its
    // owner, the same user every other field acts as.
    me: async (_source, _args, ctx) =>
      ctx.userId ? ((await loadMe(db, ctx.userId)) ?? null) : null,
  } satisfies QueryResolvers;
}

export function userFields(db: Db) {
  // A session whose user row is gone: better-auth cascades sessions with the
  // user, so this is only a deletion racing the request.
  const meOrGone = async (userId: string) => {
    const me = await loadMe(db, userId);
    if (!me) throw unauthenticated();
    return me;
  };
  return {
    setTimeZone: async (_source, args, ctx) => {
      const userId = requireUser(ctx);
      await setUserTimeZone(db, userId, args.timeZone ?? null);
      return meOrGone(userId);
    },
    setOnboarding: async (_source, args, ctx) => {
      const userId = requireUser(ctx);
      // Each flag is left as it is when omitted, so the dashboard can tick a
      // step without knowing whether the checklist has been dismissed, and
      // the other way round. Setting a flag that is already set keeps the
      // time it was first set.
      const stamp = (column: typeof user.onboardingDismissedAt, on: boolean) =>
        on ? sql<Date>`coalesce(${column}, now())` : null;
      const set = {
        ...(args.dismissed != null && {
          onboardingDismissedAt: stamp(user.onboardingDismissedAt, args.dismissed),
        }),
        ...(args.privacyReviewed != null && {
          privacyReviewedAt: stamp(user.privacyReviewedAt, args.privacyReviewed),
        }),
      };
      if (Object.keys(set).length > 0) await db.update(user).set(set).where(eq(user.id, userId));
      return meOrGone(userId);
    },
    setRetention: async (_source, args, ctx) => {
      const userId = requireUser(ctx);
      await setUserRetention(db, userId, args.days ?? null, retentionDays());
      return meOrGone(userId);
    },
    deleteRange: async (_source, args, ctx) => {
      const userId = requireUser(ctx);
      // Checked up front so someone else's device is the same NOT_FOUND every
      // other device field gives, before any argument is looked at.
      if (args.deviceId != null) {
        await requireOwned(db, devices, args.deviceId, userId, 'Unknown device');
      }
      const result = await deleteRange(db, userId, {
        from: instant(args.from, 'from'),
        to: instant(args.to, 'to'),
        deviceId: args.deviceId ?? undefined,
      });
      // Deleted between the check and the lock.
      if (!result) throw notFound('Unknown device');
      return result;
    },
    purgeApp: (_source, args, ctx) =>
      purgeApp(db, requireUser(ctx), { app: args.app, context: args.context ?? null }),
    deleteAccount: (_source, args, ctx) => deleteAccount(db, requireUser(ctx), args.email),
  } satisfies MutationResolvers;
}
