const { contextBridge, ipcRenderer } = require('electron');

// Bridges the agent UI (the Expo web export) to the agent in the main process.
// Mirrors BRIDGE_METHODS in src/host/bridge.ts — a name added there needs one
// here, and `agent:` prefixes every channel so nothing else in the app can be
// reached by guessing.
//
// Distinct from dashboard-preload.cjs, which serves a window showing REMOTE
// content and therefore exposes nothing but a single session token.
const METHODS = [
  'info',
  'loadConfig',
  'saveConfig',
  'pendingCount',
  'syncNow',
  'readLog',
  'clearLog',
  'revealLog',
  'setAutostart',
  'openDashboard',
];

const bridge = {};
for (const name of METHODS) {
  bridge[name] = (...args) => ipcRenderer.invoke(`agent:${name}`, ...args);
}

contextBridge.exposeInMainWorld('eunomia', bridge);
