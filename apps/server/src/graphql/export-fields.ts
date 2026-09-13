import type { QueryResolvers } from '@eunomia/gql/resolvers';
import type { Db } from '../db/client.ts';
import { EXPORT_PAGE_ROWS, exportChunk } from '../export/chunk.ts';
import { requireUser } from './guards.ts';

// Taking your data with you: the caller's whole account as a file, a chunk per
// call (see export/chunk.ts for why it is paged, and each format's module for
// what is in it).

export function exportFields(db: Db, pageSize = EXPORT_PAGE_ROWS) {
  return {
    // Always the caller's own account — there is no argument naming whose.
    accountExport: (_source, args, ctx) =>
      exportChunk(
        db,
        requireUser(ctx),
        {
          format: args.format,
          from: args.from,
          to: args.to,
          cursor: args.cursor,
        },
        pageSize,
      ),
  } satisfies QueryResolvers;
}
