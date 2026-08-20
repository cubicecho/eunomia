import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  type AgentConfig,
  createSanitizer,
  createUploader,
  Outbox,
  type OutboxStore,
  PING_INTERVAL_MS,
  type Ping,
  type PingSanitizer,
  syncIntervalMs,
} from '@eunomia/agent';
import { activeWindow } from '@miniben90/x-win';
import { app, Menu, nativeImage, powerMonitor, Tray } from 'electron';
import { syncAutostart } from './autostart.ts';
import { loadConfig } from './config.ts';

// Tray-only background agent. Stateless by design: it observes the foreground
// window + idle time and emits pings ("this is what the device looks like right
// now"); the server folds pings into activity intervals, so the agent never
// tracks sessions itself. It checks every second but only emits on focus/title
// change or every PING_INTERVAL_MS as a keep-alive — matching the server's
// fold tolerance (see apps/server/src/activity/fold.ts).
//
// Outbox durability, batching, and the server calls live in @eunomia/agent
// (shared with the mobile agent); this file owns the electron shell: sampling,
// tray, and the setup window.

const CHECK_INTERVAL_MS = 1_000;

// Apps whose window URL x-win can read (Windows/macOS; always empty on
// Linux). Only these pay the accessibility round-trip for the url getter.
const BROWSER_EXEC =
  /^(chrome|chromium|msedge|firefox|librewolf|waterfox|zen|brave|opera|vivaldi|arc|safari)/i;

/**
 * Hostname of the focused browser window, or null. Hostname only — full URLs
 * carry queries and tokens that should never leave the machine; the server
 * subdivides browser time by site, nothing finer.
 */
function browserContext(win: ReturnType<typeof activeWindow>, app: string | null): string | null {
  if (!app || !BROWSER_EXEC.test(app)) return null;
  try {
    const url = win.url;
    if (!url) return null;
    return new URL(url).hostname.toLowerCase() || null;
  } catch {
    return null; // unsupported browser build, or a non-URL address bar value
  }
}

function fileStore(path: string): OutboxStore {
  return {
    read: () => (existsSync(path) ? readFileSync(path, 'utf8') : null),
    append: (data) => appendFileSync(path, data),
    write: (data) => writeFileSync(path, data),
  };
}

let tray: Tray | undefined;
let lastEmit = {
  app: null as string | null,
  title: null as string | null,
  context: null as string | null,
  at: 0,
};

function checkOnce(outbox: Outbox, sanitize: PingSanitizer): void {
  try {
    const win = activeWindow();
    const app = win?.info?.execName || null;
    // Sanitized before it exists anywhere: ignored/redacted data never
    // reaches the outbox file, let alone the server.
    const ping: Ping | null = sanitize({
      capturedAt: new Date().toISOString(),
      app,
      title: win?.title || null,
      context: browserContext(win, app),
      idleSeconds: powerMonitor.getSystemIdleTime(),
    });
    if (!ping) return;

    const changed =
      ping.app !== lastEmit.app ||
      ping.title !== lastEmit.title ||
      ping.context !== lastEmit.context;
    const due = Date.now() - lastEmit.at >= PING_INTERVAL_MS;
    if (!changed && !due) return;

    outbox.push(ping);
    lastEmit = { app: ping.app, title: ping.title, context: ping.context, at: Date.now() };
  } catch (error) {
    console.error('ping failed', error);
  }
}

app.whenReady().then(async () => {
  const dataDir = app.getPath('userData');
  mkdirSync(dataDir, { recursive: true });

  // `--provision` (npm run provision): interactive one-shot that signs in,
  // registers this machine, writes config.json, and exits — no tray.
  if (process.argv.includes('--provision')) {
    // Imported lazily: the module attaches readline to stdin on load, which
    // the long-running tray path must never do.
    const { runProvisioning } = await import('./provision.ts');
    try {
      await runProvisioning(dataDir);
      app.exit(0);
    } catch (error) {
      console.error('provisioning failed:', error instanceof Error ? error.message : error);
      app.exit(1);
    }
    return;
  }

  const outbox = new Outbox(fileStore(join(dataDir, 'outbox.jsonl')));
  let config = loadConfig(dataDir);
  let sanitize = createSanitizer(config ?? {});

  // Only provisioned installs register launch-at-login; {"autostart": false}
  // in config.json opts out (and removes an earlier registration).
  if (config) syncAutostart(config.autostart !== false);

  const startUploads = (cfg: AgentConfig): void => {
    const uploader = createUploader(cfg, outbox);
    setInterval(() => void uploader.flush(), syncIntervalMs(cfg));
    void uploader.flush(); // drain whatever a previous run left behind
    console.log(`eunomia agent pinging, uploading to ${cfg.serverUrl}`);
  };

  // Onboarding window (also reachable from the tray menu while unprovisioned).
  // Uploads begin the moment it finishes — no restart needed.
  const openSetup = async (): Promise<void> => {
    // Imported lazily so the hot path never loads the window machinery.
    const { runSetupWindow } = await import('./setup.ts');
    const result = await runSetupWindow(dataDir);
    if (result) {
      config = result;
      sanitize = createSanitizer(result);
      syncAutostart(true);
      startUploads(result);
      refreshTrayMenu();
    }
  };

  const refreshTrayMenu = (): void => {
    tray?.setContextMenu(
      Menu.buildFromTemplate([
        {
          label: config ? `Uploading to ${config.serverUrl}` : 'Local only — not set up yet',
          enabled: false,
        },
        { label: `Outbox: ${join(dataDir, 'outbox.jsonl')}`, enabled: false },
        ...(config ? [] : [{ label: 'Set up uploads…', click: () => void openSetup() }]),
        { type: 'separator' as const },
        { label: 'Quit', click: () => app.quit() },
      ]),
    );
  };

  tray = new Tray(nativeImage.createEmpty());
  tray.setToolTip('eunomia — tracking active window');
  refreshTrayMenu();

  setInterval(() => checkOnce(outbox, sanitize), CHECK_INTERVAL_MS);
  if (config) {
    startUploads(config);
  } else {
    console.log('eunomia agent pinging locally; opening setup window');
    void openSetup();
  }
});

// Keep running when all windows are closed — there are no windows at all.
app.on('window-all-closed', () => {
  /* tray app: stay alive */
});
