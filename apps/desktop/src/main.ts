import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  type AgentConfig,
  createUploader,
  Outbox,
  type OutboxStore,
  PING_INTERVAL_MS,
  type Ping,
  syncIntervalMs,
} from '@eunomia/agent';
import { activeWindow } from '@miniben90/x-win';
import { app, Menu, nativeImage, powerMonitor, Tray } from 'electron';
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

function fileStore(path: string): OutboxStore {
  return {
    read: () => (existsSync(path) ? readFileSync(path, 'utf8') : null),
    append: (data) => appendFileSync(path, data),
    write: (data) => writeFileSync(path, data),
  };
}

let tray: Tray | undefined;
let lastEmit = { app: null as string | null, title: null as string | null, at: 0 };

function checkOnce(outbox: Outbox): void {
  try {
    const win = activeWindow();
    const ping: Ping = {
      capturedAt: new Date().toISOString(),
      app: win?.info?.execName || null,
      title: win?.title || null,
      idleSeconds: powerMonitor.getSystemIdleTime(),
    };

    const changed = ping.app !== lastEmit.app || ping.title !== lastEmit.title;
    const due = Date.now() - lastEmit.at >= PING_INTERVAL_MS;
    if (!changed && !due) return;

    outbox.push(ping);
    lastEmit = { app: ping.app, title: ping.title, at: Date.now() };
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

  setInterval(() => checkOnce(outbox), CHECK_INTERVAL_MS);
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
