import type { MutationResolvers } from '@eunomia/gql/resolvers';
import type { Db } from '../db/client.ts';
import { importChunk } from '../import/chunk.ts';
import { requireUser } from './guards.ts';

// Bringing history in: an account bundle, ActivityWatch, or RescueTime, a chunk
// of records per call (see import/chunk.ts for why it is paged, and each
// source's module for what it makes of the records).

export function importFields(db: Db) {
  return {
    // Always into the caller's own account — there is no argument naming whose.
    importChunk: (_source, args, ctx) =>
      importChunk(db, requireUser(ctx), {
        source: args.source,
        records: args.records,
        cursor: args.cursor,
        target: args.target,
        done: args.done,
      }),
  } satisfies MutationResolvers;
}
