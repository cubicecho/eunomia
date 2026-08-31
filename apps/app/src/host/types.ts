import type { StoredConfig } from '@eunomia/agent';

// The seam between the shared agent UI and the shell running it.
//
// The same screens drive two very different agents: on Android the app IS the
// agent — it reads the OS usage log in this process and writes config.json
// with expo-file-system. Under Electron the agent lives in the main process,
// sampling the focused window with x-win, and the UI is a renderer that can
// only ask it things over IPC. So every method here is async even where
// Android could answer synchronously, and everything either shell can't do at
// all is gated on `capabilities` rather than probed for.
//
// Implementations: host/android.ts and host/electron.ts, chosen in host/index.ts.

/**
 * What this shell can do. The screens render off these rather than off
 * `Platform.OS`, so a capability moving between shells — a desktop keep-alive,
 * an Android login item — is a one-line change here and nothing in the UI.
 */
export interface HostCapabilities {
  /** Tracking is gated on Android's usage-access special permission. */
  usageAccess: boolean;
  /**
   * Syncing is this UI's job while it is open. True on Android, where the app
   * is the agent and nothing runs between the background task's ticks; false
   * where the shell's own agent is already sampling and uploading on a
   * schedule, and a timer in here would only duplicate its flushes.
   */
  foregroundSync: boolean;
  /** Periodic sync while the app is closed can be turned on and off. */
  backgroundSync: boolean;
  /** A foreground service can hold the agent up against a force stop. */
  keepAlive: boolean;
  /** The agent can launch at login. */
  autostart: boolean;
  /** The log file can be revealed in a file manager. */
  revealLog: boolean;
  /** Over-the-air JS updates (expo-updates) apply here. */
  updates: boolean;
  /**
   * The dashboard opens in a window the shell owns rather than inside this UI.
   * True under Electron, where the tray has always opened its own BrowserWindow
   * — a sandboxed one, since it shows remote content.
   */
  externalDashboard: boolean;
}

/** What one sync pass did. Mirrors the Android agent's SyncResult. */
export interface SyncSummary {
  /**
   * Pings this pass created, or null on a shell that records continuously and
   * has nothing to synthesize — the desktop sampler is already writing pings
   * every second, so its "sync now" is a flush and the count would be a lie.
   */
  synthesized: number | null;
  /** Pings still waiting in the outbox after the upload attempt. */
  pending: number;
  provisioned: boolean;
  /** Why the upload stopped, or null when it went through (or was skipped). */
  uploadError: string | null;
}

/** Android's WorkManager enrolment, read back rather than assumed. */
export interface BackgroundState {
  registered: boolean;
  /** False when the OS won't run background work for this app at all. */
  available: boolean;
}

/** Android's keep-alive foreground service. */
export interface KeepAliveState {
  /** The service is up right now — not merely switched on. */
  running: boolean;
  /** Its notification can be shown; when false the service still runs. */
  notifications: boolean;
  /** Exempt from battery optimization, which is what background work needs. */
  batteryExempt: boolean;
}

/**
 * Facts that don't change while the app is open, resolved once at startup so
 * the screens can read them straight off the host instead of awaiting each one.
 */
export interface HostInfo {
  /**
   * There is an agent behind this UI. False in a plain browser, which is the
   * one place these screens can render with nothing to drive — see
   * host/unsupported.ts.
   */
  available: boolean;
  capabilities: HostCapabilities;
  /** Agent version, shown under the title. */
  version: string | null;
  /** `linux` | `windows` | `macos` | `android` — what a device registers as. */
  platform: string;
  /** Default device name offered at setup. */
  defaultDeviceName: string;
  /** Where the queued pings live, shown the way the tray shows it. */
  outboxPath: string;
  logPath: string;
  /**
   * Env vars are supplying the server connection, so a config.json written
   * here applies to the running agent but is ignored the next time it starts.
   * Always false on Android, which has no environment to read.
   */
  envConfigured: boolean;
}

export interface AgentHost extends HostInfo {
  loadConfig(): Promise<StoredConfig | null>;
  saveConfig(config: StoredConfig): Promise<void>;

  /** Pings waiting in the outbox, without running a sync. */
  pendingCount(): Promise<number>;
  /** Runs one pass now. Reentrancy is the shell's problem, not the screen's. */
  syncNow(): Promise<SyncSummary>;

  readLog(): Promise<string>;
  clearLog(): Promise<void>;

  /** True on shells with no such permission to grant — nothing is blocked. */
  usageAccessGranted(): Promise<boolean>;

  /**
   * Re-applies whatever the shell derives from the config — on Android the
   * WorkManager enrolment and the keep-alive service, both of which follow the
   * sync interval too. Called once at startup and after every save. Absent on
   * a shell whose agent applied the change itself when it took the save.
   */
  applyConfig?(config: StoredConfig): Promise<void>;

  /** Present iff the matching capability is set. */
  openUsageAccessSettings?(): Promise<void>;
  backgroundState?(): Promise<BackgroundState>;
  keepAliveState?(): Promise<KeepAliveState>;
  requestNotificationPermission?(): Promise<void>;
  requestBatteryExemption?(): Promise<void>;
  setAutostart?(enabled: boolean): Promise<void>;
  revealLog?(): Promise<void>;
  openDashboard?(): Promise<void>;
}
