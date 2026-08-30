import {
  initialSynthState,
  Outbox,
  type OutboxStore,
  parseConfigText,
  type StoredConfig,
  type SynthState,
  serializeConfig,
} from '@eunomia/agent';
import { File, Paths } from 'expo-file-system';

// Document-directory persistence, mirroring the desktop agent's userData
// layout: config.json (server + device API key), outbox.jsonl (crash-safe
// pending pings), sync-state.json (checkpoint the synthesizer resumes from).

// The File is resolved per call rather than once at construction: this module
// is bundled for the web and Electron targets too (the agent UI is shared),
// and expo-file-system throws the moment it is touched off-device. Nothing
// here runs on those shells — but a File built at module scope would.
function jsonFile<T>(name: string) {
  return {
    read(): T | null {
      const file = new File(Paths.document, name);
      if (!file.exists) return null;
      try {
        return JSON.parse(file.textSync()) as T;
      } catch (error) {
        console.error(`invalid ${name}`, error);
        return null;
      }
    },
    write(value: T): void {
      new File(Paths.document, name).write(`${JSON.stringify(value, null, 2)}\n`);
    },
  };
}

const CONFIG_FILE = 'config.json';

/**
 * The agent config, in exactly the shape the desktop agent writes into its
 * userData. What a config.json may contain and how it is validated lives in
 * @eunomia/agent (config.ts) — shared so the two agents cannot drift on it.
 */
export function loadConfig(): StoredConfig | null {
  const file = new File(Paths.document, CONFIG_FILE);
  return parseConfigText(file.exists ? file.textSync() : null);
}

export function writeConfig(config: StoredConfig): void {
  new File(Paths.document, CONFIG_FILE).write(serializeConfig(config));
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
