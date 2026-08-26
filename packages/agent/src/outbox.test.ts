import { describe, expect, it, vi } from 'vitest';
import { OUTBOX_MAX_PINGS, Outbox, type OutboxStore } from './outbox.ts';
import type { Ping } from './ping.ts';

interface MemoryStore extends OutboxStore {
  contents: string | null;
  /** Whole-file rewrites so far — the cost the drain has to stay clear of. */
  writes: number;
  lines(): number;
}

function memoryStore(initial: string | null = null): MemoryStore {
  return {
    contents: initial,
    writes: 0,
    read() {
      return this.contents;
    },
    append(data: string) {
      this.contents = (this.contents ?? '') + data;
    },
    write(data: string) {
      this.writes++;
      this.contents = data;
    },
    lines() {
      return this.contents ? this.contents.split('\n').filter(Boolean).length : 0;
    },
  };
}

const ping = (n: number): Ping => ({
  capturedAt: new Date(n).toISOString(),
  app: `app${n}`,
  title: null,
  context: null,
  idleSeconds: 0,
});

describe('Outbox', () => {
  it('persists pushes and reloads them', () => {
    const store = memoryStore();
    const outbox = new Outbox(store);
    outbox.push(ping(1));
    outbox.pushMany([ping(2), ping(3)]);
    expect(outbox.size).toBe(3);

    const reloaded = new Outbox(store);
    expect(reloaded.size).toBe(3);
    expect(reloaded.peek(3).map((p) => p.app)).toEqual(['app1', 'app2', 'app3']);
  });

  it('drop removes from the front and rewrites the store', () => {
    const store = memoryStore();
    const outbox = new Outbox(store);
    outbox.pushMany([ping(1), ping(2), ping(3)]);
    outbox.drop(2);
    expect(outbox.size).toBe(1);
    expect(new Outbox(store).peek(1)[0]?.app).toBe('app3');
  });

  it('skips torn lines from a crash mid-append', () => {
    const store = memoryStore(`${JSON.stringify(ping(1))}\n{"capturedAt":"tor`);
    const outbox = new Outbox(store);
    expect(outbox.size).toBe(1);
  });

  it('empties the file once the queue drains', () => {
    const store = memoryStore();
    const outbox = new Outbox(store);
    outbox.pushMany([ping(1), ping(2), ping(3)]);
    outbox.drop(3);
    expect(store.lines()).toBe(0);
    expect(new Outbox(store).size).toBe(0);
  });

  it('drains a backlog without rewriting the file per batch', () => {
    const store = memoryStore();
    const outbox = new Outbox(store);
    outbox.pushMany(Array.from({ length: 5_000 }, (_, i) => ping(i)));

    // 100 batches: the old whole-file rewrite per drop cost ~250k line writes.
    // Compaction only when it pays for itself keeps that proportional to the
    // backlog — halving the remainder each time, so ~log2(100) rewrites.
    for (let i = 0; i < 100; i++) outbox.drop(50);
    expect(outbox.size).toBe(0);
    expect(store.writes).toBeLessThan(10);
    expect(store.lines()).toBe(0);
  });

  it('re-sends acknowledged pings still on disk after a crash mid-drain', () => {
    // At-least-once: the file lags the queue between compactions, and the
    // server ignores a ping at or before the device's last recorded one.
    const store = memoryStore();
    const outbox = new Outbox(store);
    outbox.pushMany(Array.from({ length: 200 }, (_, i) => ping(i)));
    outbox.drop(50);
    expect(outbox.size).toBe(150);
    expect(new Outbox(store).size).toBe(200);
  });

  it('drops the oldest pings once it hits the cap', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const store = memoryStore();
    const outbox = new Outbox(store);
    outbox.pushMany(Array.from({ length: OUTBOX_MAX_PINGS }, (_, i) => ping(i)));
    outbox.push(ping(OUTBOX_MAX_PINGS));
    outbox.push(ping(OUTBOX_MAX_PINGS + 1));

    expect(outbox.size).toBe(OUTBOX_MAX_PINGS);
    expect(outbox.peek(1)[0]?.app).toBe('app2'); // app0 and app1 fell off
    expect(warn).toHaveBeenCalledOnce(); // one line per outage, not per ping
    warn.mockRestore();
  });

  it('caps a file left oversized by an older build', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const store = memoryStore(
      serialize(Array.from({ length: OUTBOX_MAX_PINGS * 2 }, (_, i) => ping(i))),
    );
    const outbox = new Outbox(store);
    expect(outbox.size).toBe(OUTBOX_MAX_PINGS);
    expect(store.lines()).toBe(OUTBOX_MAX_PINGS); // compacted on the way in
    warn.mockRestore();
  });
});

function serialize(pings: Ping[]): string {
  return pings.map((p) => `${JSON.stringify(p)}\n`).join('');
}
