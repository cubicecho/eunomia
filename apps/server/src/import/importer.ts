import type { z } from 'zod';
import type { Db } from '../db/client.ts';
import type { Device } from '../db/schema.ts';

// What every import source shares: the checks untrusted records go through,
// the tally a call reports, and the shape of an importer (see chunk.ts for how
// calls are driven).

/** Longest string kept from an imported field; the rest is cut off. */
export const MAX_FIELD_LENGTH = 2048;

/**
 * Earliest instant an import accepts. Nothing here predates it — ActivityWatch
 * is from 2016, RescueTime from 2008 — so an earlier timestamp is a corrupt
 * or mis-parsed one, and folding it would put a device's history in 1970.
 */
export const EARLIEST_IMPORT = Date.UTC(2000, 0, 1);

/**
 * How far past the server's clock an imported instant may be — the same
 * allowance live pings get (ping-fields.ts). Anything later is from a clock
 * that was wrong, and folding it would wedge the device the same way.
 */
const MAX_CLOCK_SKEW_MS = 2 * 60_000;

/** Whether an instant (epoch ms) is one a real recording could have. */
export const plausibleInstant = (ms: number): boolean =>
  Number.isFinite(ms) && ms >= EARLIEST_IMPORT && ms <= Date.now() + MAX_CLOCK_SKEW_MS;

/** A string field as stored: cut to MAX_FIELD_LENGTH, and blank read as absent. */
export function field(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, MAX_FIELD_LENGTH) : null;
}

/** What one call did, accumulated by the importer as it goes. */
export class Tally {
  accepted = 0;
  skipped = 0;
  pings = 0;
  readonly #warnings = new Map<string, number>();

  /** Counts a record passed over, and why — one warning per distinct reason. */
  skip(reason: string): void {
    this.skipped += 1;
    this.warn(reason);
  }

  /** Notes something the user should know that isn't a skipped record. */
  warn(message: string, times = 1): void {
    this.#warnings.set(message, (this.#warnings.get(message) ?? 0) + times);
  }

  warnings(): string[] {
    return [...this.#warnings].map(([reason, n]) => (n === 1 ? reason : `${reason} (×${n})`));
  }
}

export interface ImportRequest<S> {
  userId: string;
  state: S;
  records: readonly string[];
  /** The client has no records after these. */
  done: boolean;
  tally: Tally;
}

export interface ImportStep<S> {
  /** Null once the import is complete. */
  state: S | null;
  /** The devices written into so far — re-fenced by the importer, not trusted. */
  deviceIds: string[];
  /** BUNDLE: the client must send the file again from the top (see bundle.ts). */
  restart?: boolean;
}

/**
 * One source: how to begin, how to apply the next records, and how to check a
 * state that came back from a client. Like an export writer's, the state is
 * untrusted — every importer re-fences the ids in it on each call.
 */
export interface Importer<S> {
  state: z.ZodType<S>;
  /** Whether the source writes into one device the caller picks. */
  targeted: boolean;
  begin(db: Db, userId: string, device: Device | null): S;
  apply(db: Db, request: ImportRequest<S>): Promise<ImportStep<S>>;
}
