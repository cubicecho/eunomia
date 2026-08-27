import {
  type AgentConfig,
  initialSynthState,
  Outbox,
  type OutboxStore,
  type SynthState,
} from '@eunomia/agent';
import { File, Paths } from 'expo-file-system';
import type { BackgroundConfig } from './background.ts';

// Document-directory persistence, mirroring the desktop agent's userData
// layout: config.json (server + device API key), outbox.jsonl (crash-safe
// pending pings), sync-state.json (checkpoint the synthesizer resumes from).

function jsonFile<T>(name: string) {
  const file = new File(Paths.document, name);
  return {
    read(): T | null {
      if (!file.exists) return null;
      try {
        return JSON.parse(file.textSync()) as T;
      } catch (error) {
        console.error(`invalid ${name}`, error);
        return null;
      }
    },
    write(value: T): void {
      file.write(`${JSON.stringify(value, null, 2)}\n`);
    },
  };
}

/**
 * Mobile-only additions to the shared agent config, matching the desktop
 * agent's: the device this install registered as, so setting it up again
 * re-keys that device rather than leaving its history on a duplicate, plus
 * the background-sync choice (the phone's "start at login").
 */
export interface MobileConfig extends AgentConfig, BackgroundConfig {
  deviceId?: string;
  deviceName?: string;
}

const configFile = jsonFile<Partial<MobileConfig>>('config.json');

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string');

export function loadConfig(): MobileConfig | null {
  const parsed = configFile.read();
  if (parsed && typeof parsed.serverUrl === 'string' && typeof parsed.apiKey === 'string') {
    const config: MobileConfig = { serverUrl: parsed.serverUrl, apiKey: parsed.apiKey };
    if (typeof parsed.deviceId === 'string') config.deviceId = parsed.deviceId;
    if (typeof parsed.deviceName === 'string') config.deviceName = parsed.deviceName;
    if (typeof parsed.backgroundSync === 'boolean') config.backgroundSync = parsed.backgroundSync;
    if (typeof parsed.syncIntervalSeconds === 'number') {
      config.syncIntervalSeconds = parsed.syncIntervalSeconds;
    }
    if (isStringArray(parsed.ignoreApps)) config.ignoreApps = parsed.ignoreApps;
    if (isStringArray(parsed.redactApps)) config.redactApps = parsed.redactApps;
    return config;
  }
  return null;
}

export function writeConfig(config: MobileConfig): void {
  configFile.write(config);
}

/** How far back the first sync reaches into the OS usage log. */
const FIRST_SYNC_BACKFILL_MS = 24 * 60 * 60 * 1000;

export interface SyncState {
  /** ms epoch up to which usage events have been folded into pings. */
  checkpoint: number;
  synth: SynthState;
}

const OUTBOX_FILE = 'outbox.jsonl';

const syncStateFile = jsonFile<SyncState>('sync-state.json');

export function loadSyncState(): SyncState {
  return (
    syncStateFile.read() ?? {
      checkpoint: Date.now() - FIRST_SYNC_BACKFILL_MS,
      synth: initialSynthState(),
    }
  );
}

export function writeSyncState(state: SyncState): void {
  syncStateFile.write(state);
}

/** Where the queued pings live — shown in the app the way the tray shows it. */
export function outboxPath(): string {
  return new File(Paths.document, OUTBOX_FILE).uri;
}

export function outboxStore(): OutboxStore {
  const file = new File(Paths.document, OUTBOX_FILE);
  return {
    read: () => (file.exists ? file.textSync() : null),
    append: (data) => file.write(data, { append: true }),
    write: (data) => file.write(data),
  };
}

let outbox: Outbox | undefined;

/** Lazy singleton so foreground and background syncs share one queue. */
export function getOutbox(): Outbox {
  outbox ??= new Outbox(outboxStore());
  return outbox;
}
