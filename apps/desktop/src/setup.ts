import { hostname } from 'node:os';
import {
  DEFAULT_SYNC_INTERVAL_SECONDS,
  MIN_SYNC_INTERVAL_SECONDS,
  registerDevice,
  renameDevice,
  requestMagicLink,
  rotateDeviceKey,
  signOut,
  verifyMagicLink,
} from '@eunomia/agent';
import { BrowserWindow, ipcMain } from 'electron';
import { type DesktopConfig, platformName, writeAgentConfig } from './config.ts';

// Onboarding window shown when the agent starts unprovisioned: server URL +
// email + device name, magic-link sign-in, then registerDevice writes
// config.json and the window closes itself — the tray keeps running
// throughout. The page is an inline data URL so the packaged app needs no
// extra assets beyond the bundled main.
//
// The same window reconnects an install that already has a config (tray →
// "Change server / API key…"): pointing it at a different server registers
// there, while staying on the same server re-keys the device it already owns
// (rotateDeviceKey) so its history isn't stranded on a duplicate device.

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

interface PageDefaults {
  serverUrl: string;
  deviceName: string;
  syncIntervalSeconds: number;
  /** Launch at login — the tray has the same toggle once set up. */
  autostart: boolean;
  /** Reconnecting an existing install rather than onboarding a new one. */
  reconfigure: boolean;
  /** Env vars govern, so a written config.json won't survive a restart. */
  envConfigured: boolean;
}

// biome-ignore format: keep the page readable as one block
function setupHtml(defaults: PageDefaults): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  const heading = defaults.reconfigure ? 'Change server' : 'Set up eunomia';
  const sub = defaults.reconfigure
    ? 'Sign in to move this device to another server, or to issue it a new API key.'
    : 'Connect this device to your eunomia server.';
  const submit = defaults.reconfigure ? 'Sign in &amp; update' : 'Sign in &amp; register device';
  const verify = defaults.reconfigure ? 'Verify &amp; update' : 'Verify &amp; register device';
  const doneHeading = defaults.reconfigure ? 'Device reconnected' : 'Device registered';
  const envWarning = defaults.envConfigured
    ? `<p class="warn">EUNOMIA_SERVER_URL / EUNOMIA_API_KEY are set: this change applies now,
       but those env vars win again the next time the agent starts.</p>`
    : '';
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${defaults.reconfigure ? 'eunomia — change server' : 'eunomia setup'}</title><style>
  :root { color-scheme: light dark; }
  body { font: 14px/1.5 system-ui, sans-serif; margin: 0; padding: 28px 32px;
         background: Canvas; color: CanvasText; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  p.sub { margin: 0 0 20px; opacity: .7; }
  p.warn { margin: 0 0 20px; padding: 8px 10px; border-radius: 6px; font-size: 13px;
           background: color-mix(in srgb, #e5a50a 20%, transparent); }
  label { display: block; margin: 14px 0 4px; font-weight: 600; }
  label.check { display: flex; align-items: center; gap: 8px; margin-bottom: 0; }
  label.check input { width: auto; margin: 0; }
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
    <h1>${heading}</h1>
    <p class="sub">${sub}</p>
    ${envWarning}
    <label for="server">Server URL</label>
    <input id="server" value="${esc(defaults.serverUrl)}" required>
    <label for="email">Email</label>
    <input id="email" type="email" placeholder="you@example.com" required autofocus>
    <label for="name">Device name</label>
    <input id="name" value="${esc(defaults.deviceName)}" required>
    <label for="interval">Sync interval (seconds)</label>
    <input id="interval" type="number" min="${MIN_SYNC_INTERVAL_SECONDS}" value="${defaults.syncIntervalSeconds}" required>
    <label class="check" for="autostart">
      <input id="autostart" type="checkbox" ${defaults.autostart ? 'checked' : ''}>
      Start eunomia when I log in
    </label>
    <button id="go">${submit}</button>
  </form>
  <form id="link" class="hidden">
    <h1>Check your email</h1>
    <p class="sub" id="sentTo"></p>
    <label for="pasted">Sign-in link (or token)</label>
    <input id="pasted" placeholder="http://…/?token=…" required>
    <button>${verify}</button>
  </form>
  <div id="done" class="hidden">
    <div class="big">&#10003;</div>
    <h1>${doneHeading}</h1>
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
    autostart: $('autostart').checked,
  });

  async function finish(form, tokenOrLink) {
    const { serverUrl, name, syncIntervalSeconds, autostart } = details();
    const res = await ipcRenderer.invoke('setup:finish', { serverUrl, name, syncIntervalSeconds, autostart, tokenOrLink });
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
 * Opens the setup window and resolves with the freshly written config, or null
 * if the user closed it without finishing. Safe to call again later (from the
 * tray menu) — a second call focuses the existing window.
 *
 * Pass the live config to reconnect an install that already has one: its
 * server URL, device name, interval, autostart choice, and privacy settings
 * carry over into whatever the user submits.
 */
export function runSetupWindow(
  dataDir: string,
  current: DesktopConfig | null = null,
  options: { envConfigured?: boolean } = {},
): Promise<DesktopConfig | null> {
  if (openWindow) {
    openWindow.focus();
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    const win = new BrowserWindow({
      width: 420,
      height: current ? 660 : 600,
      resizable: false,
      autoHideMenuBar: true,
      title: current ? 'eunomia — change server' : 'eunomia setup',
      webPreferences: {
        // The page is our own inline HTML above — never remote content — so
        // giving the renderer node access (for ipcRenderer) is fine here.
        nodeIntegration: true,
        contextIsolation: false,
        sandbox: false,
      },
    });
    openWindow = win;
    let result: DesktopConfig | null = null;

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
        args: {
          serverUrl: string;
          name: string;
          syncIntervalSeconds: number;
          autostart: boolean;
          tokenOrLink: string;
        },
      ) => {
        try {
          const session = await verifyMagicLink(args.serverUrl, args.tokenOrLink);
          // Same server and a device we already own: re-key it rather than
          // registering a twin that splits this machine's history in two.
          const reKey =
            current?.deviceId !== undefined && current.serverUrl === args.serverUrl
              ? current.deviceId
              : null;
          let deviceId: string;
          let apiKey: string;
          if (reKey) {
            if (args.name !== (current?.deviceName ?? '')) {
              await renameDevice(args.serverUrl, session, reKey, args.name);
            }
            ({ deviceId, apiKey } = await rotateDeviceKey(args.serverUrl, session, reKey));
          } else {
            ({ deviceId, apiKey } = await registerDevice(
              args.serverUrl,
              session,
              args.name,
              platformName(),
            ));
          }
          const config: DesktopConfig = {
            // Privacy rules are the user's, not the server's — carry them
            // across a reconnect.
            ...current,
            autostart: args.autostart,
            serverUrl: args.serverUrl,
            apiKey,
            deviceId,
            deviceName: args.name,
            syncIntervalSeconds:
              Number.isFinite(args.syncIntervalSeconds) && args.syncIntervalSeconds > 0
                ? Math.max(MIN_SYNC_INTERVAL_SECONDS, args.syncIntervalSeconds)
                : DEFAULT_SYNC_INTERVAL_SECONDS,
          };
          const configPath = writeAgentConfig(dataDir, config);
          await signOut(args.serverUrl, session);
          console.log(
            `device ${deviceId} ("${args.name}") ${reKey ? 're-keyed' : 'registered'}, config at ${configPath}`,
          );
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
      serverUrl: current?.serverUrl ?? process.env.EUNOMIA_SERVER_URL ?? 'http://localhost:4000',
      deviceName: current?.deviceName ?? hostname(),
      syncIntervalSeconds: current?.syncIntervalSeconds ?? DEFAULT_SYNC_INTERVAL_SECONDS,
      autostart: current?.autostart !== false,
      reconfigure: current !== null,
      envConfigured: options.envConfigured === true,
    });
    void win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  });
}
