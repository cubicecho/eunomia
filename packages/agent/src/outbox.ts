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
 * Crash-safe FIFO of pending pings, mirrored to a JSONL file: every ping is
 * persisted before anything else, and removed only after the server
 * acknowledges it, so crashes and offline spells lose nothing.
 */
export class Outbox {
  // No TS parameter properties: electron runs this file with strip-only
  // type stripping, which cannot rewrite them.
  private queue: Ping[] = [];
  private readonly store: OutboxStore;

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
  }

  push(ping: Ping): void {
    this.queue.push(ping);
    this.store.append(`${JSON.stringify(ping)}\n`);
  }

  /** One store write for the whole batch — for agents that ingest in bulk. */
  pushMany(pings: Ping[]): void {
    if (pings.length === 0) return;
    this.queue.push(...pings);
    this.store.append(pings.map((p) => `${JSON.stringify(p)}\n`).join(''));
  }

  peek(count: number): Ping[] {
    return this.queue.slice(0, count);
  }

  drop(count: number): void {
    this.queue.splice(0, count);
    this.store.write(this.queue.map((p) => `${JSON.stringify(p)}\n`).join(''));
  }

  get size(): number {
    return this.queue.length;
  }
}
