// Preload for the dashboard window (plain CJS: sandboxed preloads aren't
// covered by the type-stripping dev path that runs main.ts). It runs before
// any page script and shares the page origin's storage, so seeding the token
// here means the SPA boots straight into its signed-in state — no login
// flash. Sync IPC rather than additionalArguments: argv is visible in the
// process list, the token shouldn't be.
const { ipcRenderer } = require('electron');

const token = ipcRenderer.sendSync('dashboard:token');
if (token) localStorage.setItem('eunomia.token', token);
