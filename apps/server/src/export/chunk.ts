import { z } from 'zod';
import type { Db } from '../db/client.ts';
import { badInput } from '../errors.ts';
import { isCalendarDay } from '../graphql/summaries.ts';
import { activityWatchChunk } from './activitywatch.ts';
import { bundleChunk } from './bundle.ts';
import { summariesCsvChunk } from './csv.ts';

// An account export is one file too large for one response — the raw ping log
// alone is tens of megabytes a year per device — so it is served as a query
// the client calls repeatedly, concatenating `data` until `next` comes back
// null. Each call reads a bounded number of rows and hands back a cursor that
// says where the next one starts; nothing is held server-side between calls,
// and no call ever has the whole account in memory.
//
// Chunked GraphQL rather than a streaming HTTP route: the API is GraphQL-only,
// and a cursor keeps the same authorization, error codes and permission rule
// every other field has, instead of a second path to keep in step.
//
// Not a snapshot: pings recorded, or a replay that rewrites activity ids,
// between two calls show up in whichever part of the file hadn't been read
// yet. An export taken while agents are uploading is consistent per row, not
// across rows.

export type ExportFormat = 'BUNDLE' | 'ACTIVITYWATCH' | 'SUMMARIES_CSV';

export interface ExportChunk {
  data: string;
  /** Rows read for this chunk — progress, not a count of lines in `data`. */
  rows: number;
  /** Pass back as `cursor` for the next chunk; null once the file is complete. */
  next: string | null;
}

/** What a writer gets: whose export, which days, and its own state back. */
export interface ChunkRequest<S> {
  userId: string;
  /** Calendar days in the owner's zone, [from, to); null = unbounded. */
  from: string | null;
  to: string | null;
  /** Null on the first call. */
  state: S | null;
  /** Upper bound on rows read in this call. */
  pageSize: number;
}

export interface ChunkResult<S> {
  data: string;
  rows: number;
  /** Null once the file is complete. */
  state: S | null;
}

/**
 * One format: how to write its next chunk, and how to check a state that came
 * back from a client. The state round-trips through the caller, so it is
 * untrusted — every writer re-fences each read to the caller's own devices, so
 * a forged state can skip or repeat the caller's rows but never reach anyone
 * else's.
 */
export interface ExportWriter<S> {
  state: z.ZodType<S>;
  /** Whether a date range means anything for this format. */
  ranged: boolean;
  write(db: Db, request: ChunkRequest<S>): Promise<ChunkResult<S>>;
}

/**
 * Rows per call. About a megabyte of bundle at typical window titles — small
 * enough that no response is slow to parse, large enough that a year of pings
 * is a few hundred calls rather than tens of thousands.
 */
export const EXPORT_PAGE_ROWS = 5000;

// biome-ignore lint/suspicious/noExplicitAny: each writer's state type is its own; the cursor schema below is what ties one to its format
const WRITERS: Record<ExportFormat, ExportWriter<any>> = {
  BUNDLE: bundleChunk,
  ACTIVITYWATCH: activityWatchChunk,
  SUMMARIES_CSV: summariesCsvChunk,
};

/**
 * The cursor as it travels: the request it belongs to, and the writer's state.
 * Opaque to clients (base64url JSON) — the shape is ours to change, and
 * nothing outside this file should build one.
 */
const cursorSchema = z.object({
  v: z.literal(1),
  format: z.enum(['BUNDLE', 'ACTIVITYWATCH', 'SUMMARIES_CSV']),
  from: z.string().nullable(),
  to: z.string().nullable(),
  state: z.unknown(),
});

const encodeCursor = (cursor: z.infer<typeof cursorSchema>): string =>
  Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');

function decodeCursor(value: string): z.infer<typeof cursorSchema> {
  try {
    return cursorSchema.parse(JSON.parse(Buffer.from(value, 'base64url').toString('utf8')));
  } catch {
    throw badInput('Invalid export cursor');
  }
}

export interface ExportArgs {
  format: ExportFormat;
  from?: string | null;
  to?: string | null;
  cursor?: string | null;
}

/** Writes the next chunk of `userId`'s export in `format`. */
export async function exportChunk(
  db: Db,
  userId: string,
  args: ExportArgs,
  pageSize = EXPORT_PAGE_ROWS,
): Promise<ExportChunk> {
  const writer = WRITERS[args.format];
  const from = args.from ?? null;
  const to = args.to ?? null;
  if (!writer.ranged && (from !== null || to !== null)) {
    throw badInput('This export is always the whole account; it takes no date range');
  }
  for (const day of [from, to]) {
    if (day !== null && !isCalendarDay(day)) throw badInput('Invalid date range');
  }
  if (from !== null && to !== null && from >= to) throw badInput('Invalid date range');

  let state: unknown = null;
  if (args.cursor) {
    const cursor = decodeCursor(args.cursor);
    // A cursor carries its own request so a client can't page one export's
    // position through another's — the state below only means anything for
    // the writer and the range it was written for.
    if (cursor.format !== args.format || cursor.from !== from || cursor.to !== to) {
      throw badInput('Export cursor belongs to a different export');
    }
    const parsed = writer.state.safeParse(cursor.state);
    if (!parsed.success) throw badInput('Invalid export cursor');
    state = parsed.data;
  }

  const result = await writer.write(db, { userId, from, to, state, pageSize });
  return {
    data: result.data,
    rows: result.rows,
    next:
      result.state === null
        ? null
        : encodeCursor({ v: 1, format: args.format, from, to, state: result.state }),
  };
}
