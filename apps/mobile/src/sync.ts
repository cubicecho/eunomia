import {
  createSanitizer,
  createUploader,
  type Ping,
  synthesizePings,
  type UsageEvent,
} from '@eunomia/agent';
import UsageEvents, { type NativeUsageEvent } from '../modules/usage-events';
import { getOutbox, loadConfig, loadSyncState, writeSyncState } from './store.ts';

// One sync pass: read the OS usage log since the last checkpoint, synthesize
// the pings a live agent would have emitted (shared logic in @eunomia/agent),
// persist them to the outbox, then try to drain the outbox to the server.
// Safe to run offline or unprovisioned — pings just accumulate locally.

export interface SyncResult {
  synthesized: number;
  /** Pings still waiting in the outbox after the upload attempt. */
  pending: number;
  provisioned: boolean;
}

const labelCache = new Map<string, string | null>();

function appLabel(packageName: string): string | null {
  if (!labelCache.has(packageName)) {
    labelCache.set(packageName, UsageEvents.getAppLabel(packageName));
  }
  return labelCache.get(packageName) ?? null;
}

function toUsageEvent(event: NativeUsageEvent): UsageEvent | null {
  switch (event.kind) {
    case 'foreground':
      if (!event.app) return null;
      return { at: event.at, kind: 'foreground', app: event.app, title: appLabel(event.app) };
    case 'screenOn':
    case 'screenOff':
      return { at: event.at, kind: event.kind };
  }
}

let syncing: Promise<SyncResult> | null = null;

/** Reentrancy-guarded: an overlapping call awaits the in-flight pass. */
export function performSync(): Promise<SyncResult> {
  syncing ??= syncOnce().finally(() => {
    syncing = null;
  });
  return syncing;
}

async function syncOnce(): Promise<SyncResult> {
  const outbox = getOutbox();
  const state = loadSyncState();
  const config = loadConfig();
  const now = Date.now();

  const events = UsageEvents.queryEvents(state.checkpoint, now)
    .map(toUsageEvent)
    .filter((e): e is UsageEvent => e !== null);
  const { pings, state: synth } = synthesizePings(state.synth, events, now);
  // Privacy rules apply before pings ever hit disk (see @eunomia/agent).
  const sanitize = createSanitizer(config ?? {});
  const clean = pings.map(sanitize).filter((p): p is Ping => p !== null);

  // Outbox first, checkpoint second: a crash in between re-reads the same
  // window and duplicates some pings, which merely re-touch their activity —
  // the reverse order would silently drop the window.
  outbox.pushMany(clean);
  writeSyncState({ checkpoint: now, synth });

  if (config) await createUploader(config, outbox).flush();

  return { synthesized: clean.length, pending: outbox.size, provisioned: config !== null };
}
