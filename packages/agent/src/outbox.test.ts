import { describe, expect, it } from 'vitest';
import { Outbox, type OutboxStore } from './outbox.ts';
import type { Ping } from './ping.ts';

function memoryStore(initial: string | null = null): OutboxStore & { contents: string | null } {
  return {
    contents: initial,
    read() {
      return this.contents;
    },
    append(data: string) {
      this.contents = (this.contents ?? '') + data;
    },
    write(data: string) {
      this.contents = data;
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
});
