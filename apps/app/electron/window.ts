import { BrowserWindow } from 'electron';
import { preloadPath } from './preload-path.ts';
import { AGENT_URL } from './protocol.ts';

// The agent window: the same React app the Android agent runs, rendered by
// react-native-web. It replaces what used to be a page of HTML generated as a
// template literal in this directory — setup, status, privacy and the log are
// now one UI written once.
//
// Local content, so it gets a preload with a real bridge to the agent
// (agent-preload.cjs). The dashboard window next door is the opposite case —
// remote content, fully sandboxed, one session token and nothing else.

let openWindow: BrowserWindow | undefined;

/**
 * Metro's dev server, when one is running (`npm run web -w @eunomia/app`).
 * Saves an export on every edit; unset, the window loads the built bundle.
 */
const devServer = (): string | undefined => process.env.EUNOMIA_DEV_SERVER;

export function agentWindow(): BrowserWindow | undefined {
  return openWindow?.isDestroyed() ? undefined : openWindow;
}

export async function openAgentWindow(): Promise<void> {
  const existing = agentWindow();
  if (existing) {
    existing.show();
    existing.focus();
    return;
  }

  const win = new BrowserWindow({
    width: 560,
    height: 800,
    autoHideMenuBar: true,
    title: 'eunomia',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      // Not sandboxed, unlike the dashboard: this preload needs `require`.
      // The content is ours and local, served from app:// by our own handler.
      preload: preloadPath('agent-preload.cjs'),
    },
  });
  openWindow = win;
  win.on('closed', () => {
    openWindow = undefined;
  });

  // A packaged agent has no devtools anyone will open, so a renderer that
  // throws — a bundle that never shipped, a bridge method the preload doesn't
  // expose — would fail in silence. Tee its complaints into the same agent.log
  // the main process writes, which the log screen and the tray both show.
  win.webContents.on('console-message', (details) => {
    if (details.level === 'error' || details.level === 'warning') {
      console.error(`agent ui: ${details.message} (${details.sourceId}:${details.lineNumber})`);
    }
  });
  win.webContents.on('did-fail-load', (_event, code, description, url) => {
    console.error(`agent ui failed to load ${url}: ${description} (${code})`);
  });

  const url = devServer() ?? AGENT_URL;
  await win.loadURL(url).catch((error: unknown) => {
    console.error(`could not load the agent UI from ${url}`, error);
  });
}
