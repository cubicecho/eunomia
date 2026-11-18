// Preload for the dashboard window (plain CJS: sandboxed preloads aren't
// covered by the type-stripping dev path that runs main.ts). It runs before
// any page script and shares the page origin's storage, so seeding the token
// here means the SPA boots straight into its signed-in state — no login
// flash. Sync IPC rather than additionalArguments: argv is visible in the
// process list, the token shouldn't be.
//
// The agent's provider token lives minutes, so main pushes each refreshed one;
// the SPA reads localStorage per request and picks it up on the next call.
const { ipcRenderer } = require('electron');

const TOKEN_KEY = 'eunomia.token';

const token = ipcRenderer.sendSync('dashboard:token');
if (token) localStorage.setItem(TOKEN_KEY, token);

ipcRenderer.on('dashboard:token-refreshed', (_event, next) => {
  if (typeof next === 'string' && next) localStorage.setItem(TOKEN_KEY, next);
});
