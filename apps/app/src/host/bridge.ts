import type { AgentCredential, DeviceCode, SavedConfig, StoredConfig } from '@eunomia/agent';
import type { HostInfo, PauseState, SyncSummary } from './types.ts';

// The contract between the Electron main process and the renderer that shows
// the agent UI. `electron/agent-preload.cjs` exposes exactly this on
// `window.eunomia`; `electron/ipc.ts` answers it. Keeping the shape in one
// file is what stops the two halves from drifting — the preload forwards by
// name, so a rename that only lands on one side is otherwise silent.

export interface AgentBridge {
  info(): Promise<HostInfo>;
  loadConfig(): Promise<StoredConfig | null>;
  loadSavedConfig(): Promise<SavedConfig | null>;
  saveConfig(config: StoredConfig): Promise<void>;
  pendingCount(): Promise<number>;
  syncNow(): Promise<SyncSummary>;
  readLog(): Promise<string>;
  clearLog(): Promise<void>;
  revealLog(): Promise<void>;
  setAutostart(enabled: boolean): Promise<void>;
  openDashboard(): Promise<void>;
  pauseState(): Promise<PauseState>;
  pause(ms: number | null): Promise<PauseState>;
  resume(): Promise<PauseState>;
  deviceSignInProvider(serverUrl: string): Promise<string | null>;
  startDeviceSignIn(serverUrl: string): Promise<DeviceCode>;
  finishDeviceSignIn(): Promise<AgentCredential>;
  cancelDeviceSignIn(): Promise<void>;
}

/** Every method name, in one place: the preload iterates it. */
export const BRIDGE_METHODS = [
  'info',
  'loadConfig',
  'loadSavedConfig',
  'saveConfig',
  'pendingCount',
  'syncNow',
  'readLog',
  'clearLog',
  'revealLog',
  'setAutostart',
  'openDashboard',
  'pauseState',
  'pause',
  'resume',
  'deviceSignInProvider',
  'startDeviceSignIn',
  'finishDeviceSignIn',
  'cancelDeviceSignIn',
] as const satisfies readonly (keyof AgentBridge)[];

declare global {
  // eslint-disable-next-line no-var
  var eunomia: AgentBridge | undefined;
}
