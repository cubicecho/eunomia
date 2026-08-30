import type { StoredConfig } from '@eunomia/agent';
import { type BrowserWindow, ipcMain, shell } from 'electron';

// The main-process half of src/host/bridge.ts. Every method there is one
// channel here; the preload forwards by name, so the two lists must agree.
//
// Each handler checks the sender: these calls read the device API key's
// neighbourhood and write the file the agent authenticates with, and the only
// frame that may make them is the agent window's own.

export interface AgentRuntime {
  dataDir: string;
  logPath: string;
  info(): unknown;
  loadConfig(): StoredConfig | null;
  /** Applies a finished setup: restarts uploads, autostart and sanitizing. */
  applyConfig(config: StoredConfig): void;
  pendingCount(): number;
  /** Drains the outbox now. Resolves to what is left and why. */
  flush(): Promise<{ pending: number; uploadError: string | null }>;
  readLog(): string;
  clearLog(): void;
  setAutostart(enabled: boolean): void;
  openDashboard(): Promise<void>;
}

export function registerAgentIpc(runtime: AgentRuntime, owner: () => BrowserWindow | undefined) {
  const handle = (channel: string, fn: (...args: never[]) => unknown): void => {
    ipcMain.handle(`agent:${channel}`, (event, ...args) => {
      if (event.sender !== owner()?.webContents) {
        throw new Error(`refused ${channel} from a frame that is not the agent window`);
      }
      return fn(...(args as never[]));
    });
  };

  handle('info', () => runtime.info());
  handle('loadConfig', () => runtime.loadConfig());
  handle('saveConfig', (config: StoredConfig) => {
    runtime.applyConfig(config);
  });
  handle('pendingCount', () => runtime.pendingCount());
  handle('syncNow', async () => {
    const { pending, uploadError } = await runtime.flush();
    // The desktop agent samples continuously, so a manual sync creates no
    // pings of its own — see SyncSummary.synthesized.
    return { synthesized: null, pending, provisioned: runtime.loadConfig() !== null, uploadError };
  });
  handle('readLog', () => runtime.readLog());
  handle('clearLog', () => runtime.clearLog());
  handle('revealLog', () => {
    // showItemInFolder rather than openPath: .log usually has no handler.
    shell.showItemInFolder(runtime.logPath);
  });
  handle('setAutostart', (enabled: boolean) => runtime.setAutostart(enabled));
  handle('openDashboard', () => runtime.openDashboard());
}
