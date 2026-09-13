import {
  initialSynthState,
  logRetentionDays,
  Outbox,
  type PauseWindow,
  type PingLogStore,
  parseConfigText,
  parsePauses,
  type StoredConfig,
  type SynthState,
  serializeConfig,
} from '@eunomia/agent';
import { Directory, File, Paths } from 'expo-file-system';

// Document-directory persistence, mirroring the desktop agent's userData
// layout: config.json (server + device API key), pings/ (the append-only ping
// log and its upload cursor), sync-state.json (checkpoint the synthesizer
// resumes from), pauses.json (off-the-record windows the next sync still has to
// honour).

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

/** Where older builds queued pings; migrated into the ping log on first open. */
const LEGACY_OUTBOX_FILE = 'outbox.jsonl';
const PING_LOG_DIR = 'pings';
const LOG_SUFFIX = '.jsonl';

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

const pausesFile = jsonFile<unknown>('pauses.json');

/**
 * Every off-the-record window a sync may still meet. Not just the current one:
 * the usage log is read after the fact, so a pause that ended an hour ago
 * still has pings waiting to be dropped until a sync has passed its end.
 */
export function loadPauses(): PauseWindow[] {
  return parsePauses(pausesFile.read());
}

export function writePauses(windows: PauseWindow[]): void {
  pausesFile.write(windows);
}

/** The ping log's directory — shown in the app the way the tray shows it. */
export function pingLogPath(): string {
  return new Directory(Paths.document, PING_LOG_DIR).uri;
}

export function pingLogStore(): PingLogStore {
  const dir = new Directory(Paths.document, PING_LOG_DIR);
  const dayFile = (day: string) => new File(dir, `${day}${LOG_SUFFIX}`);
  const cursorFile = new File(dir, 'cursor.json');
  const legacyFile = new File(Paths.document, LEGACY_OUTBOX_FILE);
  const ensureDir = () => {
    if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  };
  const readIfExists = (file: File) => (file.exists ? file.textSync() : null);

  return {
    days: () =>
      dir.exists
        ? dir
            .list()
            .filter((entry): entry is File => entry instanceof File)
            .map((file) => file.name)
            .filter((name) => name.endsWith(LOG_SUFFIX))
            .map((name) => name.slice(0, -LOG_SUFFIX.length))
        : [],
    read: (day) => readIfExists(dayFile(day)),
    append: (day, data) => {
      ensureDir();
      dayFile(day).write(data, { append: true });
    },
    remove: (day) => {
      const file = dayFile(day);
      if (file.exists) file.delete();
    },
    readCursor: () => readIfExists(cursorFile),
    // Temp file moved over the real one: a crash mid-write leaves the old
    // cursor whole rather than a torn one that sends the log back to the start.
    writeCursor: (data) => {
      ensureDir();
      const temp = new File(dir, 'cursor.json.tmp');
      temp.write(data);
      temp.moveSync(cursorFile, { overwrite: true });
    },
    readLegacyOutbox: () => readIfExists(legacyFile),
    removeLegacyOutbox: () => {
      if (legacyFile.exists) legacyFile.delete();
    },
  };
}

let outbox: Outbox | undefined;

/** Lazy singleton so foreground and background syncs share one log and cursor. */
export function getOutbox(): Outbox {
  // The configured retention from the first open: opening prunes, and a longer
  // setting must not lose to the default on the way in.
  outbox ??= new Outbox(pingLogStore(), { retentionDays: logRetentionDays(loadConfig() ?? {}) });
  return outbox;
}
