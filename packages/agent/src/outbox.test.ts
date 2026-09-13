import { describe, expect, it, vi } from 'vitest';
import { memoryLogStore } from './memory-store.ts';
import { DEFAULT_LOG_RETENTION_DAYS, logRetentionDays, Outbox } from './outbox.ts';
import type { Ping } from './ping.ts';

const DAY_MS = 24 * 60 * 60 * 1000;
const START = Date.parse('2026-09-13T12:00:00Z');

const ping = (n: number): Ping => ({
  capturedAt: new Date(n).toISOString(),
  app: `app${n}`,
  title: null,
  context: null,
  idleSeconds: 0,
});

const pings = (count: number, from = 0): Ping[] =>
  Array.from({ length: count }, (_, i) => ping(from + i));

function clock(start = START) {
  let now = start;
  return {
    now: () => now,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe('Outbox', () => {
  it('persists pushes and reloads them', () => {
    const store = memoryLogStore();
    const { now } = clock();
    const outbox = new Outbox(store, { now });
    outbox.push(ping(1));
    outbox.pushMany([ping(2), ping(3)]);
    expect(outbox.size).toBe(3);

    const reloaded = new Outbox(store, { now });
    expect(reloaded.size).toBe(3);
    expect(reloaded.peek(3).map((p) => p.app)).toEqual(['app1', 'app2', 'app3']);
  });

  it('writes pings to the day they were written, in UTC', () => {
    const store = memoryLogStore();
    const time = clock(Date.parse('2026-09-13T23:59:00Z'));
    const outbox = new Outbox(store, { now: time.now });
    // Captured long before — Android synthesizes pings for hours already gone.
    outbox.push(ping(0));
    time.advance(2 * 60 * 1000);
    outbox.push(ping(1));
    expect([...store.files.keys()]).toEqual(['2026-09-13', '2026-09-14']);
  });

  it('keeps acknowledged pings in the log and moves the cursor past them', () => {
    const store = memoryLogStore();
    const { now } = clock();
    const outbox = new Outbox(store, { now });
    outbox.pushMany(pings(3));
    outbox.drop(2);
    expect(outbox.size).toBe(1);
    expect(store.lines()).toBe(3); // nothing deleted on upload

    const reloaded = new Outbox(store, { now });
    expect(reloaded.size).toBe(1);
    expect(reloaded.peek(5)[0]?.app).toBe('app2');
  });

  it('drains across day files', () => {
    const store = memoryLogStore();
    const time = clock();
    const outbox = new Outbox(store, { now: time.now });
    outbox.pushMany(pings(30));
    time.advance(DAY_MS);
    outbox.pushMany(pings(30, 30));
    time.advance(DAY_MS);
    outbox.pushMany(pings(30, 60));

    const seen: string[] = [];
    while (outbox.size > 0) {
      const batch = outbox.peek(50);
      seen.push(...batch.map((p) => p.app ?? ''));
      outbox.drop(batch.length);
    }
    expect(seen).toEqual(pings(90).map((p) => p.app));
    expect(new Outbox(store, { now: time.now }).size).toBe(0);
  });

  it('never loses pings to a long outage inside the retention window', () => {
    // The old queue dropped its oldest past 50k — about six days offline.
    const store = memoryLogStore();
    const time = clock();
    const outbox = new Outbox(store, { now: time.now, retentionDays: 30 });
    for (let day = 0; day < 20; day++) {
      outbox.pushMany(pings(8_640, day * 8_640));
      time.advance(DAY_MS);
    }
    expect(outbox.size).toBe(20 * 8_640);
    expect(outbox.peek(1)[0]?.app).toBe('app0');
  });

  it('skips torn lines from a crash mid-append, and closes them off', () => {
    const store = memoryLogStore({
      files: { '2026-09-13': `${JSON.stringify(ping(1))}\n{"capturedAt":"tor` },
    });
    const { now } = clock();
    const outbox = new Outbox(store, { now });
    expect(outbox.size).toBe(1);

    // Without closing the fragment off, this ping would be glued onto it.
    outbox.push(ping(2));
    const reloaded = new Outbox(store, { now });
    expect(reloaded.peek(5).map((p) => p.app)).toEqual(['app1', 'app2']);
  });

  it('recovers a ping whose crash only missed the newline', () => {
    const store = memoryLogStore({ files: { '2026-09-13': JSON.stringify(ping(1)) } });
    const outbox = new Outbox(store, { now: clock().now });
    outbox.push(ping(2));
    expect(new Outbox(store, { now: clock().now }).size).toBe(2);
  });

  it('re-sends acknowledged pings when the cursor never made it to disk', () => {
    // At-least-once: the server ignores a ping at or before the device's last
    // recorded one, so starting over costs a drain and nothing else.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const store = memoryLogStore();
    const { now } = clock();
    const outbox = new Outbox(store, { now });
    outbox.pushMany(pings(200));
    outbox.drop(50);
    store.cursor = '{"day":"2026-09'; // torn mid-write

    expect(new Outbox(store, { now }).size).toBe(200);
    warn.mockRestore();
  });

  it('migrates a queue left by an older build, then removes it', () => {
    const legacy = `${JSON.stringify(ping(1))}\n${JSON.stringify(ping(2))}\n{"torn`;
    const store = memoryLogStore({ legacy });
    const { now } = clock();
    const outbox = new Outbox(store, { now });
    expect(outbox.size).toBe(2);
    expect(outbox.peek(5).map((p) => p.app)).toEqual(['app1', 'app2']);
    expect(store.legacy).toBeNull();

    outbox.push(ping(3));
    expect(new Outbox(store, { now }).peek(5).map((p) => p.app)).toEqual(['app1', 'app2', 'app3']);
  });

  it('re-migrates rather than skipping when a crash left the old queue behind', () => {
    const store = memoryLogStore();
    const { now } = clock();
    const outbox = new Outbox(store, { now });
    outbox.pushMany(pings(2));
    outbox.drop(2);
    store.legacy = `${JSON.stringify(ping(9))}\n`;

    const reloaded = new Outbox(store, { now });
    expect(reloaded.peek(5).map((p) => p.app)).toEqual(['app9']);
  });

  it('prunes day files past retention on a new day', () => {
    const store = memoryLogStore();
    const time = clock();
    const outbox = new Outbox(store, { now: time.now, retentionDays: 2 });
    for (let day = 0; day < 5; day++) {
      outbox.pushMany(pings(3, day * 3));
      outbox.drop(3);
      time.advance(DAY_MS);
    }
    outbox.push(ping(99));
    expect([...store.files.keys()].sort()).toEqual(['2026-09-16', '2026-09-17', '2026-09-18']);
    expect(outbox.size).toBe(1);
    expect(outbox.peek(5)[0]?.app).toBe('app99');
  });

  it('drops unsent pings past retention, and says so', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const store = memoryLogStore();
    const time = clock();
    const outbox = new Outbox(store, { now: time.now, retentionDays: 1 });
    outbox.pushMany(pings(3)); // day 0
    time.advance(DAY_MS);
    outbox.pushMany(pings(3, 3)); // day 1
    time.advance(DAY_MS);
    outbox.push(ping(6)); // day 2: day 0 falls out of the window

    expect(outbox.size).toBe(4);
    expect(outbox.peek(1)[0]?.app).toBe('app3');
    expect(warn).toHaveBeenCalledOnce();
    expect(new Outbox(store, { now: time.now, retentionDays: 1 }).size).toBe(4);
    warn.mockRestore();
  });

  it('prunes straight away when retention shrinks', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const store = memoryLogStore();
    const time = clock();
    const outbox = new Outbox(store, { now: time.now });
    for (let day = 0; day < 10; day++) {
      outbox.pushMany(pings(1, day));
      time.advance(DAY_MS);
    }
    outbox.setRetentionDays(3);
    expect(store.files.size).toBe(3);
    expect(outbox.size).toBe(3);
    warn.mockRestore();
  });

  it('never appends behind the newest file when the clock steps back', () => {
    const store = memoryLogStore();
    const time = clock();
    const outbox = new Outbox(store, { now: time.now });
    time.advance(DAY_MS);
    outbox.pushMany(pings(2));
    outbox.drop(2);
    time.advance(-DAY_MS);
    outbox.push(ping(5));
    expect(outbox.size).toBe(1);
    expect(new Outbox(store, { now: time.now }).peek(1)[0]?.app).toBe('app5');
  });
});

describe('logRetentionDays', () => {
  it('defaults and floors', () => {
    expect(logRetentionDays({})).toBe(DEFAULT_LOG_RETENTION_DAYS);
    expect(logRetentionDays({ logRetentionDays: 0 })).toBe(1);
    expect(logRetentionDays({ logRetentionDays: 90.5 })).toBe(90);
    expect(logRetentionDays({ logRetentionDays: Number.NaN })).toBe(DEFAULT_LOG_RETENTION_DAYS);
  });
});
