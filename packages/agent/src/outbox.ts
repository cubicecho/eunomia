import type { Ping } from './ping.ts';

/**
 * Where an Outbox persists its JSONL mirror. Implementations are synchronous
 * and platform-specific: node fs on desktop, expo-file-system on mobile.
 */
export interface OutboxStore {
  /** Full current contents, or null if nothing has been written yet. */
  read(): string | null;
  append(data: string): void;
  write(data: string): void;
}

/**
 * Ceiling on queued pings. A device that can't reach its server keeps
 * sampling, so without a ceiling the JSONL file grows for as long as the
 * outage lasts. At the keep-alive cadence this is ~6 days of continuous use;
 * past it the oldest pings are dropped, because recent time is the time worth
 * keeping and a file that outgrows the disk loses all of it.
 */
export const OUTBOX_MAX_PINGS = 50_000;

/**
 * Crash-safe FIFO of pending pings, mirrored to a JSONL file: every ping is
 * persisted before anything else, and removed only after the server
 * acknowledges it, so crashes and offline spells lose nothing.
 *
 * Acknowledged pings leave the queue immediately but the file only when
 * compaction pays for itself (see compact) — rewriting the whole file per
 * 50-ping batch made draining a weekend's backlog quadratic. The cost of the
 * lag is at-least-once delivery: a crash mid-drain re-sends pings the server
 * already took. That is a no-op server-side, since foldPing accrues nothing
 * for a ping at or before the device's last recorded one.
 */
export class Outbox {
  // No TS parameter properties: electron runs this file with strip-only
  // type stripping, which cannot rewrite them.
  private queue: Ping[] = [];
  /** Index of the oldest live ping; everything before it is gone from the queue but not yet from the file. */
  private head = 0;
  private readonly store: OutboxStore;
  private warnedFull = false;

  constructor(store: OutboxStore) {
    this.store = store;
    const existing = store.read();
    if (existing !== null) {
      this.queue = existing
        .split('\n')
        .filter(Boolean)
        .flatMap((line) => {
          try {
            return [JSON.parse(line) as Ping];
          } catch {
            return []; // torn write from a crash mid-append
          }
        });
    }
    this.enforceCap();
  }

  push(ping: Ping): void {
    this.queue.push(ping);
    this.store.append(`${JSON.stringify(ping)}\n`);
    this.enforceCap();
  }

  /** One store write for the whole batch — for agents that ingest in bulk. */
  pushMany(pings: Ping[]): void {
    if (pings.length === 0) return;
    this.queue.push(...pings);
    this.store.append(serialize(pings));
    this.enforceCap();
  }

  peek(count: number): Ping[] {
    return this.queue.slice(this.head, this.head + count);
  }

  drop(count: number): void {
    this.head = Math.min(this.head + count, this.queue.length);
    this.compact();
    if (this.size === 0) this.warnedFull = false;
  }

  get size(): number {
    return this.queue.length - this.head;
  }

  /**
   * Rewrites the file without the acknowledged prefix, but only once that
   * prefix is at least as long as what's left — so the bytes rewritten over a
   * drain stay proportional to the pings drained instead of squaring. In the
   * common case (queue fully drained) it truncates the file to nothing.
   */
  private compact(): void {
    if (this.head === 0 || this.head < this.size) return;
    this.queue = this.queue.slice(this.head);
    this.head = 0;
    this.store.write(serialize(this.queue));
  }

  /** Drops the oldest pings once the queue passes OUTBOX_MAX_PINGS. */
  private enforceCap(): void {
    const overflow = this.size - OUTBOX_MAX_PINGS;
    if (overflow <= 0) return;
    this.head += overflow;
    // One line per outage, not one per casualty: what's worth saying is that
    // this outage has started losing data.
    if (!this.warnedFull) {
      console.warn(`outbox full (${OUTBOX_MAX_PINGS} pings) — dropping the oldest`);
      this.warnedFull = true;
    }
    this.compact();
  }
}

function serialize(pings: Ping[]): string {
  return pings.map((p) => `${JSON.stringify(p)}\n`).join('');
}
