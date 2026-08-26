// Preload for the setup window (plain CJS, like dashboard-preload.cjs:
// sandboxed preloads aren't covered by the type-stripping dev path that runs
// main.ts). The page behind it is our own generated HTML, but it handles an
// email address and a sign-in link, so it runs under the same rules as the
// dashboard window: no node in the renderer, an isolated context, and exactly
// these two calls reaching the main process.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('eunomiaSetup', {
  /** Sends a magic link. Resolves {token} (dev servers), {} or {error}. */
  start: (args) => ipcRenderer.invoke('setup:start', args),
  /** Redeems the link and writes config.json. Resolves {ok} or {error}. */
  finish: (args) => ipcRenderer.invoke('setup:finish', args),
});
