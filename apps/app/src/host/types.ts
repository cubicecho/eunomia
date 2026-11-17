import type { AgentCredential, DeviceCode, SavedConfig, StoredConfig } from '@eunomia/agent';

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
  /**
   * Recording can be paused "off the record" for a while. Every shell that
   * records can; it's a capability so the browser host, which records
   * nothing, has no button that pretends otherwise.
   */
  pause: boolean;
  /**
   * The agent can sign in through the server's OIDC provider with the device
   * flow: it shows a code, opens the provider's page in the system browser,
   * and waits for the person to approve it there. Off in a plain browser.
   */
  deviceSignIn: boolean;
}

/** Whether recording is paused right now, read back from the shell. */
export interface PauseState {
  paused: boolean;
  /** Epoch ms the pause ends on its own, or null: until resumed (or not paused). */
  until: number | null;
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
  /** The ping log's directory, shown the way the tray shows it. */
  pingLogPath: string;
  logPath: string;
}

export interface AgentHost extends HostInfo {
  loadConfig(): Promise<StoredConfig | null>;
  /**
   * What config.json holds even when it can't start an agent — a config from
   * before agents signed in as their person still names its server, device
   * and settings, which setup keeps.
   */
  loadSavedConfig(): Promise<SavedConfig | null>;
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
  pauseState?(): Promise<PauseState>;
  /** Pauses for `ms` from now, or until resumed when null. */
  pause?(ms: number | null): Promise<PauseState>;
  resume?(): Promise<PauseState>;
  /**
   * The device flow, present iff `capabilities.deviceSignIn`. Run by the shell
   * rather than this UI: under Electron the provider's endpoints are called
   * from the main process, which no renderer CORS rule reaches.
   */
  /** What the server's provider is called, when it lets agents sign in through it; else null. */
  deviceSignInProvider?(serverUrl: string): Promise<string | null>;
  /**
   * Starts a sign-in and opens the provider's page in the system browser.
   * Resolves to the code to show; one sign-in at a time, so starting another
   * cancels the last.
   */
  startDeviceSignIn?(serverUrl: string): Promise<DeviceCode>;
  /** Waits for the started sign-in to be approved. Rejects with a message to show. */
  finishDeviceSignIn?(): Promise<AgentCredential>;
  cancelDeviceSignIn?(): Promise<void>;
}
