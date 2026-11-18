import type { TokenSource } from '@eunomia/agent';
import { BrowserWindow, dialog, ipcMain } from 'electron';
import { preloadPath } from './preload-path.ts';

// The dashboard window: the server-hosted web app, signed in as the agent is,
// so viewing the dashboard never needs a second sign-in. Unlike the agent
// window this shows remote content, so the renderer is fully sandboxed and
// gets the agent's bearer and nothing else, via sync IPC answered exclusively
// for this window's own frame (see dashboard-preload.cjs): a provider access
// token, which lives minutes and is pushed in again each time the agent
// refreshes it (the refresh token never leaves this process), or the session a
// sign-in link opened, which signing out in the dashboard ends for the agent
// too.

let openWindow: BrowserWindow | undefined;
let opening = false;

/**
 * How often an open dashboard asks for the bearer, which refreshes a provider
 * token nearing its expiry: uploads ask too, but on the sync interval, which
 * may be longer than the token lives.
 */
const KEEP_FRESH_MS = 30_000;

export async function openDashboard(serverUrl: string, tokens: TokenSource): Promise<void> {
  if (openWindow) {
    openWindow.focus();
    return;
  }
  if (opening) return;
  opening = true;

  try {
    let token: string;
    try {
      token = await tokens.bearer();
    } catch (error) {
      // Offline at refresh time, or signed out at the provider.
      dialog.showErrorBox(
        'eunomia',
        `Could not open the dashboard at ${serverUrl}:\n${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return;
    }

    const win = new BrowserWindow({
      width: 1100,
      height: 750,
      autoHideMenuBar: true,
      title: 'eunomia',
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        preload: preloadPath('dashboard-preload.cjs'),
      },
    });
    openWindow = win;

    const handleToken = (event: Electron.IpcMainEvent): void => {
      // sendSync blocks the caller until returnValue is set — answer every
      // sender, but hand the token only to this window's own preload.
      event.returnValue = event.sender === win.webContents ? token : null;
    };
    ipcMain.on('dashboard:token', handleToken);
    // The agent refreshes its token while the window is open (each upload
    // asks for one); the page reads it per request, so storing the new one is
    // all it takes.
    const unsubscribe = tokens.subscribe((next) => {
      token = next;
      if (!win.isDestroyed()) win.webContents.send('dashboard:token-refreshed', next);
    });
    const keepFresh = setInterval(() => void tokens.bearer().catch(() => {}), KEEP_FRESH_MS);
    win.on('closed', () => {
      openWindow = undefined;
      ipcMain.removeListener('dashboard:token', handleToken);
      unsubscribe();
      clearInterval(keepFresh);
    });

    await win.loadURL(serverUrl).catch((error: unknown) => {
      dialog.showErrorBox(
        'eunomia',
        `Could not load ${serverUrl}:\n${error instanceof Error ? error.message : String(error)}`,
      );
      if (!win.isDestroyed()) win.close();
    });
  } finally {
    opening = false;
  }
}
