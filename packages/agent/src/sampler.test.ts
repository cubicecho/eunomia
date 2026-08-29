import { afterEach, describe, expect, it, vi } from 'vitest';
import { Outbox, type OutboxStore } from './outbox.ts';
import { PING_INTERVAL_MS, type Ping } from './ping.ts';
import { createSanitizer } from './privacy.ts';
import {
  CHECK_INTERVAL_MS,
  createSampler,
  HEARTBEAT_INTERVAL_MS,
  type Sample,
  type SamplerStatus,
} from './sampler.ts';

function memoryStore(): OutboxStore {
  let contents: string | null = null;
  return {
    read: () => contents,
    append: (data) => {
      contents = (contents ?? '') + data;
    },
    write: (data) => {
      contents = data;
    },
  };
}

const sample = (over: Partial<Sample> = {}): Sample => ({
  app: 'firefox',
  title: 'a page',
  idleSeconds: 0,
  ...over,
});

interface Harness {
  outbox: Outbox;
  pings(): Ping[];
  /** Runs `count` ticks, advancing the clock CHECK_INTERVAL_MS between them. */
  run(count: number): void;
  contextReads: number;
  status(): SamplerStatus;
  /** Overwritten per test to change what the OS reports. */
  read: () => Sample;
}

function harness(options: { ignoreApps?: string[]; context?: string | null } = {}): Harness {
  const outbox = new Outbox(memoryStore());
  const sanitize = createSanitizer({ ignoreApps: options.ignoreApps });
  let clock = 1_700_000_000_000;
  const state: Harness = {
    outbox,
    read: () => sample(),
    contextReads: 0,
    pings: () => outbox.peek(1000),
    run: () => {},
    status: () => sampler.status(),
  };
  const sampler = createSampler({
    outbox,
    read: () => state.read(),
    readContext: () => {
      state.contextReads++;
      return options.context ?? null;
    },
    sanitize: () => sanitize,
    now: () => clock,
  });
  state.run = (count: number) => {
    for (let i = 0; i < count; i++) {
      sampler.tick();
      clock += CHECK_INTERVAL_MS;
    }
  };
  return state;
}

afterEach(() => vi.restoreAllMocks());

describe('sampler emission', () => {
  it('emits once on first sight and then at the keep-alive cadence', () => {
    const h = harness();
    h.run(PING_INTERVAL_MS / CHECK_INTERVAL_MS + 1);
    // One for the first sight, one when the keep-alive came due.
    expect(h.pings()).toHaveLength(2);
  });

  it('emits on a title change without waiting for the keep-alive', () => {
    const h = harness();
    h.run(1);
    h.read = () => sample({ title: 'another page' });
    h.run(1);
    expect(h.pings().map((p) => p.title)).toEqual(['a page', 'another page']);
  });

  it('reads the browser context once per emitted ping, not once per tick', () => {
    const h = harness({ context: 'github.com' });
    h.run(PING_INTERVAL_MS / CHECK_INTERVAL_MS + 1);
    // The accessibility round trip is the expensive part of a tick: paying it
    // on every one is what made a focused browser cost ~86k of them a day.
    expect(h.contextReads).toBe(2);
    expect(h.pings()[0]?.context).toBe('github.com');
  });

  it('keeps looking for a change while an ignored app is focused', () => {
    const h = harness({ ignoreApps: ['^keepass'] });
    h.read = () => sample({ app: 'keepass' });
    h.run(3);
    expect(h.pings()).toHaveLength(0);
    // The ignored app must not be remembered as emitted, or returning to a
    // tracked app one tick later would look unchanged and emit nothing.
    h.read = () => sample({ app: 'code' });
    h.run(1);
    expect(h.pings().map((p) => p.app)).toEqual(['code']);
  });
});

describe('sampler health', () => {
  it('reports unhealthy once the OS stops answering, and recovers', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const h = harness();
    h.run(1);
    expect(h.status().healthy).toBe(true);

    h.read = () => {
      throw new Error('x-win: no active window');
    };
    h.run(4);
    const broken = h.status();
    expect(broken.healthy).toBe(false);
    expect(broken.failures).toBe(4);
    expect(broken.error).toBe('x-win: no active window');

    h.read = () => sample();
    h.run(1);
    expect(h.status()).toMatchObject({ healthy: true, failures: 0, error: null });
  });

  it('logs a repeating failure at most once a minute, with the count it stands for', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const h = harness();
    h.read = () => {
      throw new Error('boom');
    };
    // Two minutes of failing every second: unthrottled this is 120 lines, and
    // the agent log truncates at 512 KB — a stuck sampler would erase the very
    // evidence that it was stuck.
    h.run(120);
    expect(error).toHaveBeenCalledTimes(2);
    expect(error.mock.calls[1]?.[0]).toContain('and 59 more');
  });

  it('records that a ping was queued, not just that a tick ran', () => {
    const h = harness({ ignoreApps: ['^firefox'] });
    h.run(2);
    const status = h.status();
    // Sampling works; it just has nothing it's allowed to report.
    expect(status.lastSampleAt).not.toBeNull();
    expect(status.lastPingAt).toBeNull();
    expect(status.healthy).toBe(true);
  });
});

describe('sampler stalls', () => {
  it('reports a gap the timer swallowed', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const outbox = new Outbox(memoryStore());
    let clock = 0;
    const sampler = createSampler({
      outbox,
      read: () => sample(),
      readContext: () => null,
      sanitize: () => (ping) => ping,
      now: () => clock,
    });
    sampler.tick();
    clock += 30_000; // a native call blocked the main thread for 30s
    sampler.tick();
    expect(warn).toHaveBeenCalledWith('sampler stalled 30s — no ticks ran');
  });

  it('summarizes each period, so the log can answer "was it tracking then?"', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const outbox = new Outbox(memoryStore());
    let clock = 0;
    const sampler = createSampler({
      outbox,
      read: () => sample(),
      readContext: () => null,
      sanitize: () => (ping) => ping,
      now: () => clock,
    });
    sampler.tick();
    expect(log).not.toHaveBeenCalled();
    clock += HEARTBEAT_INTERVAL_MS;
    sampler.tick();
    expect(log).toHaveBeenCalledWith(expect.stringContaining('sampler: 1 ticks, 1 pings'));
  });
});
