import {
  type AgentConfig,
  initialSynthState,
  Outbox,
  type OutboxStore,
  type SynthState,
} from '@eunomia/agent';
import { File, Paths } from 'expo-file-system';

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

const configFile = jsonFile<Partial<AgentConfig>>('config.json');

export function loadConfig(): AgentConfig | null {
  const parsed = configFile.read();
  if (parsed && typeof parsed.serverUrl === 'string' && typeof parsed.apiKey === 'string') {
    return { serverUrl: parsed.serverUrl, apiKey: parsed.apiKey };
  }
  return null;
}

export function writeConfig(config: AgentConfig): void {
  configFile.write(config);
}

/** How far back the first sync reaches into the OS usage log. */
const FIRST_SYNC_BACKFILL_MS = 24 * 60 * 60 * 1000;

export interface SyncState {
  /** ms epoch up to which usage events have been folded into pings. */
  checkpoint: number;
  synth: SynthState;
}

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

export function outboxStore(): OutboxStore {
  const file = new File(Paths.document, 'outbox.jsonl');
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
