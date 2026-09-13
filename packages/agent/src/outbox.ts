import type { Ping } from './ping.ts';

/**
 * Where an Outbox keeps its ping log. Implementations are synchronous and
 * platform-specific: node fs on desktop, expo-file-system on mobile.
 *
 * The log is one append-only JSONL file per UTC day (`pings/2026-09-13.jsonl`)
 * plus a small cursor file saying how far into it the server has acknowledged.
 */
export interface PingLogStore {
  /** Day keys (`YYYY-MM-DD`) that have a file, in any order. */
  days(): string[];
  /** Full contents of one day's file, or null if it doesn't exist. */
  read(day: string): string | null;
  /** Appends to a day's file, creating it (and its directory) as needed. */
  append(day: string, data: string): void;
  remove(day: string): void;
  readCursor(): string | null;
  /**
   * Replaces the cursor. Should be atomic where the platform allows (write a
   * temp file, rename it over): a torn cursor is recovered by re-sending the
   * whole log, which loses nothing but costs a long drain.
   */
  writeCursor(data: string): void;
  /** The queue file older builds kept (`outbox.jsonl`), for one-time migration. */
  readLegacyOutbox(): string | null;
  removeLegacyOutbox(): void;
}

/** Days of ping log kept on the device when the config doesn't say. */
export const DEFAULT_LOG_RETENTION_DAYS = 30;

/** Floor for user-set retention: today's file is the one being written. */
export const MIN_LOG_RETENTION_DAYS = 1;

/** Resolves a config's log retention to whole days — defaulted and floored. */
export function logRetentionDays(config: { logRetentionDays?: number }): number {
  const days = config.logRetentionDays;
  if (typeof days !== 'number' || !Number.isFinite(days)) return DEFAULT_LOG_RETENTION_DAYS;
  return Math.max(MIN_LOG_RETENTION_DAYS, Math.floor(days));
}

export interface OutboxOptions {
  /** See logRetentionDays. Changeable later with setRetentionDays. */
  retentionDays?: number;
  /** Clock, for tests. */
  now?: () => number;
}

/** A position in the log: the next line of `day` the server hasn't taken. */
interface Cursor {
  day: string;
  line: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Pending pings, as a cursor into an append-only ping log.
 *
 * Every ping is appended to the day's log file before anything else, and
 * nothing is ever deleted on upload: acknowledging a batch only moves the
 * cursor. So the log is a record of what the agent captured — exportable,
 * replayable — and an outage costs nothing until it outlasts the retention
 * window, where the old queue silently dropped its oldest pings past 50k.
 *
 * Files are keyed by the day a ping was *written*, not captured: Android
 * synthesizes pings for hours already gone, and appending those to an older
 * file would put them behind the cursor, never to be uploaded. UTC for the
 * same reason — a local date can step backwards when the timezone changes.
 *
 * Delivery is at-least-once: the cursor is persisted after the server takes a
 * batch, so a crash in between re-sends it. That is a no-op server-side: the
 * server's raw ping log drops a ping identical to one it already stored,
 * before anything folds it.
 */
export class Outbox {
  // No TS parameter properties: electron runs this file with strip-only
  // type stripping, which cannot rewrite them.
  private readonly store: PingLogStore;
  private readonly now: () => number;
  private retentionDays: number;
  private cursor: Cursor;
  private pending = 0;
  /** Newest day written to; appends never go to an older one. */
  private lastDay: string | null;
  /**
   * Parsed lines of one day's file — the one the cursor is reading. A single
   * day is the most ever held in memory, however long the backlog. Unparseable
   * lines stay as null so line numbers keep matching the file.
   */
  private window: { day: string; entries: (Ping | null)[] } | null = null;

  constructor(store: PingLogStore, options: OutboxOptions = {}) {
    this.store = store;
    this.now = options.now ?? Date.now;
    this.retentionDays = options.retentionDays ?? DEFAULT_LOG_RETENTION_DAYS;

    this.lastDay = this.sortedDays().at(-1) ?? null;
    this.terminateTornLine();
    // Before the cursor is read: a missing one means "from the start", which is
    // exactly where the migrated pings need it.
    this.migrateLegacyOutbox();
    this.cursor = this.loadCursor();
    this.prune();
    this.pending = this.countPending();
  }

  push(ping: Ping): void {
    this.pushMany([ping]);
  }

  /** One store write for the whole batch — for agents that ingest in bulk. */
  pushMany(pings: Ping[]): void {
    if (pings.length === 0) return;
    const day = this.appendDay();
    this.store.append(day, serialize(pings));
    this.pending += pings.length;
    if (this.window?.day === day) for (const ping of pings) this.window.entries.push(ping);
  }

  peek(count: number): Ping[] {
    return this.scan(count).pings;
  }

  /** Acknowledges the first `count` pending pings: moves the cursor past them. */
  drop(count: number): void {
    if (count <= 0 || this.pending === 0) return;
    const { pings, end } = this.scan(count);
    this.cursor = end;
    this.pending -= pings.length;
    this.saveCursor();
  }

  get size(): number {
    return this.pending;
  }

  /** Applies a changed retention — pruning straight away if it shrank. */
  setRetentionDays(days: number): void {
    if (days === this.retentionDays) return;
    this.retentionDays = days;
    if (this.prune()) this.pending = this.countPending();
  }

  /**
   * Today's file, or the newest one if that's later: a clock stepping back
   * across midnight would otherwise append behind the cursor. A new day is
   * also when old files are due to go.
   */
  private appendDay(): string {
    const day = this.targetDay();
    if (day !== this.lastDay) {
      this.lastDay = day;
      if (this.prune()) this.pending = this.countPending();
    }
    return day;
  }

  private targetDay(): string {
    const today = dayKey(this.now());
    return this.lastDay !== null && this.lastDay > today ? this.lastDay : today;
  }

  /**
   * Collects up to `count` pings from the cursor on, and the position just
   * past the last one — crossing into later days as each file runs out.
   */
  private scan(count: number): { pings: Ping[]; end: Cursor } {
    const pings: Ping[] = [];
    let { day, line } = this.cursor;
    let later: string[] | null = null;
    while (pings.length < count) {
      const entries = this.entries(day);
      while (line < entries.length && pings.length < count) {
        const entry = entries[line++];
        if (entry) pings.push(entry);
      }
      if (pings.length === count) break;
      // Listed once per scan, and only when a batch spans a day boundary.
      later ??= this.sortedDays();
      const next = later.find((d) => d > day);
      if (next === undefined) break;
      day = next;
      line = 0;
    }
    return { pings, end: { day, line } };
  }

  private entries(day: string): (Ping | null)[] {
    if (this.window?.day !== day) {
      this.window = { day, entries: parseLines(this.store.read(day)) };
    }
    return this.window.entries;
  }

  /**
   * A crash mid-append can leave the newest file ending in half a line. The
   * next append would glue a whole ping onto it and lose both, so the fragment
   * is closed off first — it then reads as one unparseable line, and if the
   * crash only missed the newline, as the ping it was.
   */
  private terminateTornLine(): void {
    if (this.lastDay === null) return;
    const text = this.store.read(this.lastDay);
    if (text && !text.endsWith('\n')) this.store.append(this.lastDay, '\n');
  }

  /**
   * Moves pings queued by a build that predates the log into it, then removes
   * the old file. A crash between the two re-migrates them next start: a
   * duplicate in the log, and a re-send the server ignores.
   */
  private migrateLegacyOutbox(): void {
    const legacy = this.store.readLegacyOutbox();
    if (legacy === null) return;
    const lines = legacy.split('\n').filter(Boolean);
    if (lines.length > 0) {
      // No pruning yet: there is no cursor to prune against until this is done.
      const day = this.targetDay();
      this.lastDay = day;
      // Carried as text, torn lines and all: they're skipped on read like any
      // other, and re-serializing would only be a chance to lose something.
      const complete = lines.map((line) => `${line}\n`).join('');
      // Where the migrated lines start, so an existing cursor can be pointed
      // at them rather than left past them.
      const start = parseLines(this.store.read(day)).length;
      this.store.append(day, complete);
      const cursor = this.readStoredCursor();
      if (cursor !== null && (cursor.day > day || (cursor.day === day && cursor.line > start))) {
        this.writeCursorValue({ day, line: start });
      }
    }
    this.store.removeLegacyOutbox();
  }

  /**
   * The persisted cursor, or the start of the log when there isn't a usable
   * one — re-sending what the server already has is a no-op, skipping what it
   * doesn't is a loss.
   */
  private loadCursor(): Cursor {
    const stored = this.readStoredCursor();
    if (stored !== null) return stored;
    const cursor = { day: this.sortedDays()[0] ?? dayKey(this.now()), line: 0 };
    this.writeCursorValue(cursor);
    return cursor;
  }

  private readStoredCursor(): Cursor | null {
    const text = this.store.readCursor();
    if (text === null) return null;
    try {
      const parsed = JSON.parse(text) as Partial<Cursor>;
      if (
        typeof parsed.day === 'string' &&
        DAY_KEY.test(parsed.day) &&
        typeof parsed.line === 'number' &&
        Number.isInteger(parsed.line) &&
        parsed.line >= 0
      ) {
        return { day: parsed.day, line: parsed.line };
      }
    } catch {
      // fall through — torn by a crash mid-write
    }
    console.warn('unreadable outbox cursor — re-sending the ping log from the start');
    return null;
  }

  private saveCursor(): void {
    this.writeCursorValue(this.cursor);
  }

  private writeCursorValue(cursor: Cursor): void {
    this.store.writeCursor(`${JSON.stringify(cursor)}\n`);
  }

  /**
   * Deletes day files older than the retention window. Retention wins over
   * the cursor: an outage longer than the window loses its oldest pings, but
   * says so, and the log can't outgrow the disk. Returns whether anything
   * pending may have gone, so the caller knows to recount.
   */
  private prune(): boolean {
    const cutoff = dayKey(this.now() - this.retentionDays * DAY_MS);
    const expired = this.sortedDays().filter((day) => day < cutoff);
    if (expired.length === 0) return false;

    const unsent = expired.includes(this.cursor.day) || this.cursor.day < cutoff;
    let lost = 0;
    if (unsent) {
      for (const day of expired) {
        if (day < this.cursor.day) continue;
        const entries = this.entries(day);
        const from = day === this.cursor.day ? this.cursor.line : 0;
        lost += entries.slice(from).filter(Boolean).length;
      }
    }
    for (const day of expired) {
      this.store.remove(day);
      if (this.window?.day === day) this.window = null;
    }
    if (unsent) {
      this.cursor = { day: this.sortedDays()[0] ?? dayKey(this.now()), line: 0 };
      this.saveCursor();
      if (lost > 0) {
        console.warn(
          `ping log retention (${this.retentionDays} days) reached — ${lost} unsent pings dropped`,
        );
      }
    }
    return unsent;
  }

  /** Valid pings from the cursor to the end of the log. */
  private countPending(): number {
    let count = 0;
    for (const day of this.sortedDays()) {
      if (day < this.cursor.day) continue;
      const entries =
        day === this.cursor.day ? this.entries(day) : parseLines(this.store.read(day));
      const from = day === this.cursor.day ? this.cursor.line : 0;
      for (let i = from; i < entries.length; i++) if (entries[i]) count++;
    }
    return count;
  }

  private sortedDays(): string[] {
    return this.store
      .days()
      .filter((day) => DAY_KEY.test(day))
      .sort();
  }
}

function dayKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Complete lines only: whatever follows the last newline is still being written. */
function parseLines(text: string | null): (Ping | null)[] {
  if (!text) return [];
  const lines = text.split('\n');
  lines.pop();
  return lines.map((line) => {
    if (!line) return null;
    try {
      return JSON.parse(line) as Ping;
    } catch {
      return null; // torn write from a crash mid-append
    }
  });
}

function serialize(pings: Ping[]): string {
  return pings.map((p) => `${JSON.stringify(p)}\n`).join('');
}
