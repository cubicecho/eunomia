import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import { z } from 'zod';
import { replayDevice } from '../activity/replay.ts';
import type { Db } from '../db/client.ts';
import { type Device, devices } from '../db/schema.ts';
import { badInput } from '../errors.ts';
import { requireOwned } from '../graphql/guards.ts';
import { activityWatchImporter } from './activitywatch.ts';
import { bundleImporter } from './bundle.ts';
import { type Importer, Tally } from './importer.ts';
import { rescueTimeImporter } from './rescuetime.ts';

// Imports are the export's mirror image (export/chunk.ts): a file too large for
// one request, sent by the client a bounded list of records per call, with an
// opaque cursor carrying whatever the importer needs from one call to the next.
// Nothing is held server-side between calls.
//
// The browser reads the file — gunzipping, splitting lines, parsing the JSON or
// CSV a source comes in — because only it has the file; what reaches the
// server is untrusted records, each validated here on its own. A record that
// is malformed or implausible is skipped and counted, not fatal: one bad line
// in a year of history shouldn't cost the rest. What IS fatal is a call that
// can't be applied meaningfully at all — an unreadable cursor, records out of
// order, a file that isn't the format it was sent as.
//
// Every call is one transaction. A call that fails leaves nothing behind, so
// the client can send the same records with the same cursor again; that is what
// makes a dropped connection halfway through a large import recoverable.
//
// Always the caller's own account: no argument names a user, a target device is
// fenced like every other device id (requireOwned), and the ids a cursor
// carries are re-fenced on every call — a forged cursor can point an import at
// a different one of the caller's devices, never at anyone else's.

export type ImportSource = 'BUNDLE' | 'ACTIVITYWATCH' | 'RESCUETIME';

/** Records per call. The client's chunk size is well under it. */
export const MAX_IMPORT_RECORDS = 5000;

/** One record's length, in UTF-16 code units — a window title is a few hundred. */
export const MAX_RECORD_LENGTH = 64 * 1024;

/** Every record in a call together. */
export const MAX_IMPORT_CHARS = 8 * 1024 * 1024;

const PLATFORMS = ['windows', 'macos', 'linux', 'android'] as const;

/** Where a single-device source writes, named on the first call only. */
export interface ImportTarget {
  /** An existing device of the caller's. */
  deviceId?: string | null;
  /** Or a new device, created by the first call. */
  newDeviceName?: string | null;
  platform?: string | null;
}

// biome-ignore lint/suspicious/noExplicitAny: each importer's state type is its own; the cursor schema below is what ties one to its source
const IMPORTERS: Record<ImportSource, Importer<any>> = {
  BUNDLE: bundleImporter,
  ACTIVITYWATCH: activityWatchImporter,
  RESCUETIME: rescueTimeImporter,
};

const cursorSchema = z.object({
  v: z.literal(1),
  source: z.enum(['BUNDLE', 'ACTIVITYWATCH', 'RESCUETIME']),
  state: z.unknown(),
});

const encodeCursor = (cursor: z.infer<typeof cursorSchema>): string =>
  Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');

function decodeCursor(value: string): z.infer<typeof cursorSchema> {
  try {
    return cursorSchema.parse(JSON.parse(Buffer.from(value, 'base64url').toString('utf8')));
  } catch {
    throw badInput('Invalid import cursor');
  }
}

export interface ImportArgs {
  source: ImportSource;
  records: readonly string[];
  cursor?: string | null;
  target?: ImportTarget | null;
  done?: boolean | null;
}

export interface ImportChunk {
  /** Pass back as `cursor` with the next records; null once the import is complete. */
  next: string | null;
  accepted: number;
  skipped: number;
  pings: number;
  restart: boolean;
  deviceIds: string[];
  warnings: string[];
}

/** The device a targeted import's first call writes into, created if asked for. */
async function resolveTarget(db: Db, userId: string, target: ImportTarget): Promise<Device> {
  if (target.deviceId != null) {
    if (target.newDeviceName != null) {
      throw badInput('Import into an existing device or a new one, not both');
    }
    return requireOwned(db, devices, target.deviceId, userId, 'Unknown device');
  }
  const name = target.newDeviceName?.trim().slice(0, 200);
  if (!name) throw badInput('Name the device to import into');
  const platform = PLATFORMS.find((p) => p === target.platform);
  if (!platform) throw badInput(`Unknown platform; use one of ${PLATFORMS.join(', ')}`);
  const [row] = await db
    .insert(devices)
    .values({ id: crypto.randomUUID(), userId, name, platform })
    .returning();
  return row!;
}

/** Applies the next records of `userId`'s import from `source`. */
export async function importChunk(db: Db, userId: string, args: ImportArgs): Promise<ImportChunk> {
  const importer = IMPORTERS[args.source];
  if (args.records.length > MAX_IMPORT_RECORDS) {
    throw badInput(`Too many records in one call (max ${MAX_IMPORT_RECORDS})`);
  }
  let chars = 0;
  for (const record of args.records) {
    if (record.length > MAX_RECORD_LENGTH) {
      throw badInput(`A record is longer than ${MAX_RECORD_LENGTH} characters`);
    }
    chars += record.length;
  }
  if (chars > MAX_IMPORT_CHARS) throw badInput('Too much data in one call');

  let resumed: unknown = null;
  if (args.cursor) {
    const cursor = decodeCursor(args.cursor);
    if (cursor.source !== args.source) {
      throw badInput('Import cursor belongs to a different import');
    }
    // The target is chosen once. Accepting it again would let one import
    // quietly change device halfway through.
    if (args.target) throw badInput('The target is only given on the first call');
    const parsed = importer.state.safeParse(cursor.state);
    if (!parsed.success) throw badInput('Invalid import cursor');
    resumed = parsed.data;
  } else if (importer.targeted ? !args.target : args.target) {
    throw badInput(
      importer.targeted
        ? 'Pick a device to import into'
        : 'A bundle restores its own devices; it takes no target',
    );
  }

  const tally = new Tally();
  const done = args.done ?? false;
  const step = await db.transaction(async (tx) => {
    const state =
      resumed ??
      importer.begin(
        tx,
        userId,
        importer.targeted ? await resolveTarget(tx, userId, args.target!) : null,
      );
    return importer.apply(tx, { userId, state, records: args.records, done, tally });
  });

  if (step.state === null) {
    // Pings older than a device's log head are logged but wait for replay
    // (ingest.ts). The timer would get to them within a minute; finishing an
    // import is a better moment than "soon", since the user is looking.
    const pending = step.deviceIds.length
      ? await db
          .select({ id: devices.id })
          .from(devices)
          .where(
            and(
              eq(devices.userId, userId),
              inArray(devices.id, step.deviceIds),
              isNotNull(devices.replayFrom),
            ),
          )
      : [];
    for (const { id } of pending) await replayDevice(db, id);
  }

  return {
    next:
      step.state === null ? null : encodeCursor({ v: 1, source: args.source, state: step.state }),
    accepted: tally.accepted,
    skipped: tally.skipped,
    pings: tally.pings,
    restart: step.restart ?? false,
    deviceIds: step.deviceIds,
    warnings: tally.warnings(),
  };
}
