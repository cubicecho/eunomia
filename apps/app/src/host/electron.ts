import type { StoredConfig } from '@eunomia/agent';
import type { AgentBridge } from './bridge.ts';
import type { AgentHost } from './types.ts';

// The Electron shell: the agent runs in the main process (window sampling with
// x-win, the tray, the outbox), and this renderer only asks it things. Every
// call is one `ipcRenderer.invoke` behind `window.eunomia`, which
// electron/agent-preload.cjs puts there.

export function hasElectronBridge(): boolean {
  return typeof globalThis.eunomia === 'object' && globalThis.eunomia !== null;
}

export async function createElectronHost(): Promise<AgentHost> {
  const bridge = globalThis.eunomia as AgentBridge;
  // The main process owns the answers to all of these — the version it was
  // packaged as, which platform a device registers as, where its userData is.
  const info = await bridge.info();

  return {
    ...info,
    loadConfig: () => bridge.loadConfig(),
    saveConfig: (config: StoredConfig) => bridge.saveConfig(config),
    pendingCount: () => bridge.pendingCount(),
    syncNow: () => bridge.syncNow(),
    readLog: () => bridge.readLog(),
    clearLog: () => bridge.clearLog(),
    revealLog: () => bridge.revealLog(),
    setAutostart: (enabled: boolean) => bridge.setAutostart(enabled),
    openDashboard: () => bridge.openDashboard(),
    // Nothing to grant: the desktop agent reads the focused window directly,
    // and macOS's screen-recording prompt is the OS's to raise, not ours.
    usageAccessGranted: async () => true,
  };
}
