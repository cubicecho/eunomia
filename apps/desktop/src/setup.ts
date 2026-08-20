import { hostname } from 'node:os';
import { BrowserWindow, ipcMain } from 'electron';
import {
  type AgentConfig,
  DEFAULT_SYNC_INTERVAL_SECONDS,
  MIN_SYNC_INTERVAL_SECONDS,
  registerDevice,
  requestMagicLink,
  signOut,
  verifyMagicLink,
} from '@eunomia/agent';
import { platformName, writeAgentConfig } from './config.ts';

// Onboarding window shown when the agent starts unprovisioned: server URL +
// email + device name, magic-link sign-in, then registerDevice writes
// config.json and the window closes itself — the tray keeps running
// throughout. The page is an inline data URL so the packaged app needs no
// extra assets beyond the bundled main.

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// biome-ignore format: keep the page readable as one block
function setupHtml(defaults: { serverUrl: string; deviceName: string }): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>eunomia setup</title><style>
  :root { color-scheme: light dark; }
  body { font: 14px/1.5 system-ui, sans-serif; margin: 0; padding: 28px 32px;
         background: Canvas; color: CanvasText; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  p.sub { margin: 0 0 20px; opacity: .7; }
  label { display: block; margin: 14px 0 4px; font-weight: 600; }
  input { width: 100%; box-sizing: border-box; padding: 8px 10px; font: inherit;
          border: 1px solid color-mix(in srgb, CanvasText 25%, transparent);
          border-radius: 6px; background: Field; color: FieldText; }
  button { margin-top: 22px; width: 100%; padding: 9px; font: inherit; font-weight: 600;
           border: 0; border-radius: 6px; background: #4f6ef7; color: #fff; cursor: pointer; }
  button:disabled { opacity: .5; cursor: default; }
  #error { color: #d33; margin: 12px 0 0; min-height: 1.5em; }
  .hidden { display: none; }
  #done { text-align: center; padding-top: 60px; }
  #done .big { font-size: 40px; }
</style></head><body>
  <form id="details">
    <h1>Set up eunomia</h1>
    <p class="sub">Connect this device to your eunomia server.</p>
    <label for="server">Server URL</label>
    <input id="server" value="${esc(defaults.serverUrl)}" required>
    <label for="email">Email</label>
    <input id="email" type="email" placeholder="you@example.com" required autofocus>
    <label for="name">Device name</label>
    <input id="name" value="${esc(defaults.deviceName)}" required>
    <label for="interval">Sync interval (seconds)</label>
    <input id="interval" type="number" min="${MIN_SYNC_INTERVAL_SECONDS}" value="${DEFAULT_SYNC_INTERVAL_SECONDS}" required>
    <button id="go">Sign in &amp; register device</button>
  </form>
  <form id="link" class="hidden">
    <h1>Check your email</h1>
    <p class="sub" id="sentTo"></p>
    <label for="pasted">Sign-in link (or token)</label>
    <input id="pasted" placeholder="http://…/?token=…" required>
    <button>Verify &amp; register device</button>
  </form>
  <div id="done" class="hidden">
    <div class="big">&#10003;</div>
    <h1>Device registered</h1>
    <p class="sub">eunomia is now running in your tray.</p>
  </div>
  <p id="error"></p>
<script>
  const { ipcRenderer } = require('electron');
  const $ = (id) => document.getElementById(id);
  const error = (msg) => { $('error').textContent = msg; };
  const busy = (form, on) => { for (const el of form.elements) el.disabled = on; };
  const details = () => ({
    serverUrl: $('server').value.trim().replace(/\\/+$/, ''),
    email: $('email').value.trim().toLowerCase(),
    name: $('name').value.trim(),
    syncIntervalSeconds: Number($('interval').value),
  });

  async function finish(form, tokenOrLink) {
    const { serverUrl, name, syncIntervalSeconds } = details();
    const res = await ipcRenderer.invoke('setup:finish', { serverUrl, name, syncIntervalSeconds, tokenOrLink });
    busy(form, false);
    if (res.error) return error(res.error);
    $('details').classList.add('hidden');
    $('link').classList.add('hidden');
    $('done').classList.remove('hidden');
  }

  $('details').addEventListener('submit', async (e) => {
    e.preventDefault();
    error('');
    busy(e.target, true);
    const { serverUrl, email } = details();
    const res = await ipcRenderer.invoke('setup:start', { serverUrl, email });
    if (res.error) { busy(e.target, false); return error(res.error); }
    if (res.token) return finish(e.target, res.token);
    busy(e.target, false);
    $('details').classList.add('hidden');
    $('sentTo').textContent = 'A sign-in link was sent to ' + email + '. Paste it below.';
    $('link').classList.remove('hidden');
    $('pasted').focus();
  });

  $('link').addEventListener('submit', (e) => {
    e.preventDefault();
    error('');
    busy(e.target, true);
    finish(e.target, $('pasted').value.trim());
  });
</script></body></html>`;
}

let openWindow: BrowserWindow | undefined;

/**
 * Opens the onboarding window and resolves with the freshly written config,
 * or null if the user closed it without finishing. Safe to call again later
 * (e.g. from the tray menu) — a second call focuses the existing window.
 */
export function runSetupWindow(dataDir: string): Promise<AgentConfig | null> {
  if (openWindow) {
    openWindow.focus();
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    const win = new BrowserWindow({
      width: 420,
      height: 560,
      resizable: false,
      autoHideMenuBar: true,
      title: 'eunomia setup',
      webPreferences: {
        // The page is our own inline HTML above — never remote content — so
        // giving the renderer node access (for ipcRenderer) is fine here.
        nodeIntegration: true,
        contextIsolation: false,
        sandbox: false,
      },
    });
    openWindow = win;
    let result: AgentConfig | null = null;

    ipcMain.handle('setup:start', async (_event, args: { serverUrl: string; email: string }) => {
      try {
        return { token: await requestMagicLink(args.serverUrl, args.email) };
      } catch (error) {
        return { error: errorMessage(error) };
      }
    });

    ipcMain.handle(
      'setup:finish',
      async (
        _event,
        args: { serverUrl: string; name: string; syncIntervalSeconds: number; tokenOrLink: string },
      ) => {
        try {
          const session = await verifyMagicLink(args.serverUrl, args.tokenOrLink);
          const { deviceId, apiKey } = await registerDevice(
            args.serverUrl,
            session,
            args.name,
            platformName(),
          );
          const config: AgentConfig = {
            serverUrl: args.serverUrl,
            apiKey,
            syncIntervalSeconds:
              Number.isFinite(args.syncIntervalSeconds) && args.syncIntervalSeconds > 0
                ? Math.max(MIN_SYNC_INTERVAL_SECONDS, args.syncIntervalSeconds)
                : DEFAULT_SYNC_INTERVAL_SECONDS,
          };
          const configPath = writeAgentConfig(dataDir, config);
          await signOut(args.serverUrl, session);
          console.log(`device ${deviceId} ("${args.name}") registered, config at ${configPath}`);
          result = config;
          setTimeout(() => {
            if (!win.isDestroyed()) win.close();
          }, 1500);
          return { ok: true };
        } catch (error) {
          return { error: errorMessage(error) };
        }
      },
    );

    win.on('closed', () => {
      openWindow = undefined;
      ipcMain.removeHandler('setup:start');
      ipcMain.removeHandler('setup:finish');
      resolve(result);
    });

    const html = setupHtml({
      serverUrl: process.env.EUNOMIA_SERVER_URL ?? 'http://localhost:4000',
      deviceName: hostname(),
    });
    void win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  });
}
