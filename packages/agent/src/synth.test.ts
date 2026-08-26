import { describe, expect, it } from 'vitest';
import { initialSynthState, SYNTH_INTERVAL_MS, synthesizePings, type UsageEvent } from './synth.ts';

const T0 = Date.UTC(2026, 0, 1, 12, 0, 0);
const at = (ms: number) => new Date(T0 + ms).toISOString();

describe('synthesizePings', () => {
  it('emits nothing from fresh state with no events', () => {
    const { pings, state } = synthesizePings(initialSynthState(), [], T0 + 60_000);
    expect(pings).toEqual([]);
    expect(state.app).toBeNull();
  });

  it('opens a span on a foreground event and keeps it alive', () => {
    const events: UsageEvent[] = [{ at: T0, kind: 'foreground', app: 'com.app.a', title: 'A' }];
    const { pings, state } = synthesizePings(
      initialSynthState(),
      events,
      T0 + 2 * SYNTH_INTERVAL_MS,
    );
    expect(pings.map((p) => p.capturedAt)).toEqual([
      at(0),
      at(SYNTH_INTERVAL_MS),
      at(2 * SYNTH_INTERVAL_MS),
    ]);
    expect(pings.every((p) => p.app === 'com.app.a' && p.idleSeconds === 0)).toBe(true);
    expect(state).toMatchObject({ app: 'com.app.a', screenOn: true });
  });

  it('closes the old app and opens the new one at a switch', () => {
    const events: UsageEvent[] = [
      { at: T0, kind: 'foreground', app: 'a', title: null },
      { at: T0 + 10_000, kind: 'foreground', app: 'b', title: null },
    ];
    const { pings } = synthesizePings(initialSynthState(), events, T0 + 10_000);
    expect(pings.map((p) => [p.capturedAt, p.app])).toEqual([
      [at(0), 'a'],
      [at(10_000), 'a'], // closing ping credits the final 10s to a
      [at(10_000), 'b'], // zero-gap opener for b
    ]);
  });

  it('stops emitting while the screen is off and resumes on screenOn', () => {
    const events: UsageEvent[] = [
      { at: T0, kind: 'foreground', app: 'a', title: null },
      { at: T0 + 5_000, kind: 'screenOff' },
      { at: T0 + 300_000, kind: 'screenOn' },
    ];
    const { pings } = synthesizePings(initialSynthState(), events, T0 + 300_000);
    expect(pings.map((p) => p.capturedAt)).toEqual([at(0), at(5_000), at(300_000)]);
  });

  it('a foreground event while the screen is off only takes effect at screenOn', () => {
    const events: UsageEvent[] = [
      { at: T0, kind: 'screenOff' },
      { at: T0 + 1_000, kind: 'foreground', app: 'a', title: null },
      { at: T0 + 60_000, kind: 'screenOn' },
    ];
    const { pings } = synthesizePings(initialSynthState(), events, T0 + 60_000 + SYNTH_INTERVAL_MS);
    expect(pings.map((p) => [p.capturedAt, p.app])).toEqual([
      [at(60_000), 'a'],
      [at(60_000 + SYNTH_INTERVAL_MS), 'a'],
    ]);
  });

  it('continues an ongoing span across runs via carried state', () => {
    const first = synthesizePings(
      initialSynthState(),
      [{ at: T0, kind: 'foreground', app: 'a', title: null }],
      T0 + SYNTH_INTERVAL_MS,
    );
    const second = synthesizePings(first.state, [], T0 + 3 * SYNTH_INTERVAL_MS);
    expect(second.pings.map((p) => p.capturedAt)).toEqual([
      at(2 * SYNTH_INTERVAL_MS),
      at(3 * SYNTH_INTERVAL_MS),
    ]);
  });

  it('sorts out-of-order events and never emits backwards', () => {
    const events: UsageEvent[] = [
      { at: T0 + 10_000, kind: 'foreground', app: 'b', title: null },
      { at: T0, kind: 'foreground', app: 'a', title: null },
    ];
    const { pings } = synthesizePings(initialSynthState(), events, T0 + 10_000);
    const times = pings.map((p) => Date.parse(p.capturedAt));
    expect(times).toEqual([...times].sort((x, y) => x - y));
    expect(pings[0]?.app).toBe('a');
    expect(pings.at(-1)?.app).toBe('b');
  });
});
