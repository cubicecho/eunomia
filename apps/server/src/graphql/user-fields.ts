import type { MutationResolvers, QueryResolvers } from '@eunomia/gql/resolvers';
import { loadUserTimeZone, setUserTimeZone } from '../activity/time-zone.ts';
import type { Db } from '../db/client.ts';
import { unauthenticated } from '../errors.ts';
import { requireUser } from './guards.ts';

// The caller's own account: who they are, and the one setting the server keeps
// for them — the time zone their days split in.

export function userQueryFields(db: Db) {
  return {
    // Public: null for an anonymous request rather than an error, so a client
    // can ask "am I signed in?" without handling one. A key answers for its
    // owner, the same user every other field acts as.
    me: async (_source, _args, ctx) =>
      ctx.userId ? ((await loadUserTimeZone(db, ctx.userId)) ?? null) : null,
  } satisfies QueryResolvers;
}

export function userFields(db: Db) {
  return {
    setTimeZone: async (_source, args, ctx) => {
      const me = await setUserTimeZone(db, requireUser(ctx), args.timeZone ?? null);
      // A session whose user row is gone: better-auth cascades sessions with
      // the user, so this is only a deletion racing the request.
      if (!me) throw unauthenticated();
      return me;
    },
  } satisfies MutationResolvers;
}
