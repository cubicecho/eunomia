import type { AgentHost } from './types.ts';

// `expo start --web` in a plain browser. The web target exists to be the
// Electron renderer — a browser has no focused-window API, no usage log and
// nowhere to keep an API key, so there is no agent here to drive. Rather than
// crash on the first native call, the host reports every capability off and
// the status screen says where this UI is supposed to run. The dashboard a
// browser visitor actually wants is apps/web, served by the server at /.

const unavailable = (): never => {
  throw new Error('no agent is running here — open the desktop app');
};

export function createUnsupportedHost(): AgentHost {
  return {
    available: false,
    capabilities: {
      usageAccess: false,
      foregroundSync: false,
      backgroundSync: false,
      keepAlive: false,
      autostart: false,
      revealLog: false,
      updates: false,
      externalDashboard: false,
    },
    version: null,
    platform: 'linux',
    defaultDeviceName: 'this browser',
    outboxPath: '',
    logPath: '',
    envConfigured: false,
    loadConfig: async () => null,
    saveConfig: unavailable,
    pendingCount: async () => 0,
    syncNow: unavailable,
    readLog: async () => '',
    clearLog: async () => undefined,
    usageAccessGranted: async () => false,
  };
}
