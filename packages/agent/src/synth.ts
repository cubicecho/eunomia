import type { Ping } from './ping.ts';

// Retroactive ping synthesis for platforms where the OS already keeps a usage
// log (Android's UsageStatsManager). Instead of sampling live like the desktop
// tray, the agent periodically reads the event history since its last
// checkpoint and synthesizes the pings a live agent would have emitted.
//
// The server accrues min(gap since previous ping, ACCRUE_CAP_SECONDS = 30) to
// each ping's app, so keep-alives every SYNTH_INTERVAL_MS (< 30s) make a
// foreground span accrue fully. At a transition we emit a closing ping for the
// outgoing app (crediting the final partial gap to it) and an opening ping for
// the incoming app at the same instant (zero-gap, just starts the row). While
// the screen is off nothing is emitted, so that time never accrues.

/** Keep-alive spacing for synthesized pings — under the server's 30s accrual cap. */
export const SYNTH_INTERVAL_MS = 25_000;

export type UsageEvent =
  | { at: number; kind: 'foreground'; app: string; title: string | null }
  | { at: number; kind: 'screenOn' }
  | { at: number; kind: 'screenOff' };

/** Carried across synthesis runs so an ongoing span continues seamlessly. */
export interface SynthState {
  screenOn: boolean;
  app: string | null;
  title: string | null;
  /** ms epoch of the last synthesized ping, or 0 if none yet. */
  lastEmitAt: number;
}

export function initialSynthState(): SynthState {
  return { screenOn: true, app: null, title: null, lastEmitAt: 0 };
}

/**
 * Folds usage events (sorted or not) into the pings a live agent would have
 * emitted between the previous checkpoint and `endAt`, returning the state to
 * carry into the next run. Pings come out in chronological order — the server
 * folds them serially and attributes each gap to the ping's own app.
 */
export function synthesizePings(
  state: SynthState,
  events: UsageEvent[],
  endAt: number,
): { pings: Ping[]; state: SynthState } {
  const next: SynthState = { ...state };
  const pings: Ping[] = [];

  const emit = (at: number, app: string | null, title: string | null): void => {
    if (at < next.lastEmitAt) return; // never go backwards — serial fold assumes order
    // No sub-app context on Android — the server's title rules can supply one.
    pings.push({ capturedAt: new Date(at).toISOString(), app, title, context: null, idleSeconds: 0 });
    next.lastEmitAt = at;
  };

  // Keep-alives across the quiet stretch up to `until`, anchored on the last
  // emit. No anchor yet (fresh state) means nothing to keep alive.
  const fill = (until: number): void => {
    if (!next.screenOn || next.app === null || next.lastEmitAt === 0) return;
    while (next.lastEmitAt + SYNTH_INTERVAL_MS <= until) {
      emit(next.lastEmitAt + SYNTH_INTERVAL_MS, next.app, next.title);
    }
  };

  const sorted = [...events].sort((a, b) => a.at - b.at);
  for (const event of sorted) {
    fill(event.at);
    switch (event.kind) {
      case 'foreground': {
        if (next.screenOn) {
          if (next.app !== null) emit(event.at, next.app, next.title); // close out the old span
          emit(event.at, event.app, event.title); // zero-gap opener for the new one
        }
        next.app = event.app;
        next.title = event.title;
        break;
      }
      case 'screenOff': {
        if (next.screenOn && next.app !== null) emit(event.at, next.app, next.title);
        next.screenOn = false;
        break;
      }
      case 'screenOn': {
        next.screenOn = true;
        // Accrues at most the 30s cap against the pre-sleep gap — same as the
        // desktop agent's first ping after wake.
        if (next.app !== null) emit(event.at, next.app, next.title);
        break;
      }
    }
  }

  fill(endAt);
  return { pings, state: next };
}
