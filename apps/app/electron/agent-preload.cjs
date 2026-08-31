const { contextBridge, ipcRenderer } = require('electron');
const { BRIDGE_METHODS } = require('../src/host/bridge.ts');

// Bridges the agent UI (the Expo web export) to the agent in the main process.
// The method list is imported, not restated: src/host/bridge.ts declares the
// contract, electron/ipc.ts answers it, and this forwards it. `agent:` prefixes
// every channel so nothing else in the app can be reached by guessing.
//
// This is why build:preload bundles — a preload runs before any module loader
// the app has, so the import has to be resolved ahead of time. bridge.ts costs
// nothing to pull in: everything else it holds is a type.
//
// Distinct from dashboard-preload.cjs, which serves a window showing REMOTE
// content and therefore exposes nothing but a single session token.
const bridge = {};
for (const name of BRIDGE_METHODS) {
  bridge[name] = (...args) => ipcRenderer.invoke(`agent:${name}`, ...args);
}

contextBridge.exposeInMainWorld('eunomia', bridge);
