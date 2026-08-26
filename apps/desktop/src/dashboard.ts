import { join } from 'node:path';
import { type AgentConfig, sessionFromDeviceKey } from '@eunomia/agent';
import { app, BrowserWindow, dialog, ipcMain } from 'electron';

// The dashboard window: the server-hosted web app, signed in with a session
// minted from the device key (sessionFromDeviceKey), so viewing the dashboard
// never needs a second magic-link login. Unlike the setup window this shows
// remote content, so the renderer is fully sandboxed and the long-lived API
// key never enters it — only the short-lived session token crosses over, via
// sync IPC answered exclusively for this window's own frame (see
// dashboard-preload.cjs).

let openWindow: BrowserWindow | undefined;
let opening = false;

// Packaged builds ship the preload next to main.cjs in dist/ (build:preload);
// dev runs it straight from src/. Loaded by path at runtime, so esbuild's
// bundle never sees it.
const preloadPath = (): string =>
  join(app.getAppPath(), app.isPackaged ? 'dist' : 'src', 'dashboard-preload.cjs');

export async function openDashboard(config: AgentConfig): Promise<void> {
  if (openWindow) {
    openWindow.focus();
    return;
  }
  if (opening) return;
  opening = true;

  try {
    // Fresh token per open; expiry mid-view just shows the dashboard's own
    // sign-in screen, and reopening the window recovers.
    let token: string;
    try {
      token = await sessionFromDeviceKey(config.serverUrl, config.apiKey);
    } catch (error) {
      // Offline, revoked key, or a server that predates sessionFromDeviceKey.
      dialog.showErrorBox(
        'eunomia',
        `Could not open the dashboard at ${config.serverUrl}:\n${
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
        preload: preloadPath(),
      },
    });
    openWindow = win;

    const handleToken = (event: Electron.IpcMainEvent): void => {
      // sendSync blocks the caller until returnValue is set — answer every
      // sender, but hand the token only to this window's own preload.
      event.returnValue = event.sender === win.webContents ? token : null;
    };
    ipcMain.on('dashboard:token', handleToken);
    win.on('closed', () => {
      openWindow = undefined;
      ipcMain.removeListener('dashboard:token', handleToken);
    });

    await win.loadURL(config.serverUrl).catch((error: unknown) => {
      dialog.showErrorBox(
        'eunomia',
        `Could not load ${config.serverUrl}:\n${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      if (!win.isDestroyed()) win.close();
    });
  } finally {
    opening = false;
  }
}
