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
  type Uploader,
} from '@eunomia/agent';
import { activeWindow } from '@miniben90/x-win';
import { app, Menu, nativeImage, powerMonitor, shell, Tray } from 'electron';
import { syncAutostart } from './autostart.ts';
import { type DesktopConfig, isEnvConfigured, loadConfig } from './config.ts';
import { startFileLog } from './log.ts';
import { TRAY_ICON_16, TRAY_ICON_32 } from './tray-icon.ts';

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

// One agent per machine. A second instance would sample in parallel and share
// outbox.jsonl, where Outbox.drop()'s whole-file rewrite silently erases
// whatever the other instance queued in the meantime — so the second launch
// surfaces the first one's window and exits. `--provision` is a one-shot CLI
// that writes config.json and quits, so it stays allowed alongside the tray.
const provisioning = process.argv.includes('--provision');
const primary = provisioning || app.requestSingleInstanceLock();
// exit(), not quit(): a quit requested before 'ready' is swallowed, and this
// process owns nothing yet — the 'second-instance' event has already been
// delivered to the agent that holds the lock.
//
// Measured caveat on Linux: chromium's singleton handshake waits for the
// running instance to answer on a unix socket, and a tray app with a context
// menu doesn't answer it — the second launch waits ~20s, decides the owner is
// dead, takes the lock and starts a second agent anyway. Windows (the packaged
// target) uses a message window instead and hands off immediately.
if (!primary) app.exit(0);

/** What a second launch should show; set once the tray exists. */
let surfaceUi: (() => void) | undefined;
app.on('second-instance', () => surfaceUi?.());

app.whenReady().then(async () => {
  if (!primary) return; // exiting: another agent already owns this profile

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

  const logPath = startFileLog(dataDir);
  const outbox = new Outbox(fileStore(join(dataDir, 'outbox.jsonl')));
  let config = loadConfig(dataDir);
  let sanitize = createSanitizer(config ?? {});

  // Only provisioned installs register launch-at-login; {"autostart": false}
  // in config.json opts out (and removes an earlier registration).
  if (config) syncAutostart(config.autostart !== false);

  let uploader: Uploader | undefined;
  let syncTimer: ReturnType<typeof setInterval> | undefined;

  // Restartable: reconnecting to another server (or re-keying) swaps the
  // uploader and its schedule in place. Anything already queued goes up to the
  // new server — they're this machine's pings either way.
  const startUploads = (cfg: AgentConfig): void => {
    if (syncTimer) clearInterval(syncTimer);
    uploader = createUploader(cfg, outbox);
    const flush = () => void uploader?.flush().then(refreshTrayMenu);
    syncTimer = setInterval(flush, syncIntervalMs(cfg));
    flush(); // drain whatever a previous run left behind
    console.log(`eunomia agent pinging, uploading to ${cfg.serverUrl}`);
  };

  // Setup window: onboarding while unprovisioned, and the "change server /
  // API key" flow once provisioned (pass the live config to prefill it and
  // keep this machine's device identity). Uploads restart the moment it
  // finishes — no restart of the agent needed.
  const openSetup = async (current: DesktopConfig | null = null): Promise<void> => {
    // Imported lazily so the hot path never loads the window machinery.
    const { runSetupWindow } = await import('./setup.ts');
    const result = await runSetupWindow(dataDir, current, { envConfigured: isEnvConfigured() });
    if (result) {
      config = result;
      sanitize = createSanitizer(result);
      syncAutostart(result.autostart !== false);
      startUploads(result);
      refreshTrayMenu();
    }
  };

  // Dashboard window: the server-hosted web app, signed in via the device
  // key. Lazily imported like setup — the hot path never loads it.
  const showDashboard = async (): Promise<void> => {
    if (!config) return;
    const { openDashboard } = await import('./dashboard.ts');
    await openDashboard(config);
  };

  // A stalled upload is otherwise invisible: pings keep queueing to disk while
  // the tray claims all is well. Revoked key, wrong URL, server down — say so.
  const uploadLabel = (): string => {
    if (!config) return 'Local only — not set up yet';
    const status = uploader?.status();
    if (status?.error) return `Upload failing: ${status.error} (${status.pending} queued)`;
    if (status && status.pending > 0) {
      return `Uploading to ${config.serverUrl} (${status.pending} queued)`;
    }
    return `Uploading to ${config.serverUrl}`;
  };

  const refreshTrayMenu = (): void => {
    tray?.setToolTip(
      uploader?.status().error
        ? 'eunomia — tracking, but uploads are failing'
        : 'eunomia — tracking active window',
    );
    tray?.setContextMenu(
      Menu.buildFromTemplate([
        { label: `eunomia agent ${app.getVersion()}`, enabled: false },
        { label: uploadLabel(), enabled: false },
        { label: `Outbox: ${join(dataDir, 'outbox.jsonl')}`, enabled: false },
        ...(config
          ? [
              { label: 'Open Dashboard', click: () => void showDashboard() },
              { label: 'Change server / API key…', click: () => void openSetup(config) },
            ]
          : [{ label: 'Set up uploads…', click: () => void openSetup() }]),
        // The only window into a packaged agent's console — showItemInFolder
        // rather than openPath, since .log often has no handler registered.
        { label: 'Show log file…', click: () => shell.showItemInFolder(logPath) },
        { type: 'separator' as const },
        { label: 'Quit', click: () => app.quit() },
      ]),
    );
  };

  // Data-URL icon: nothing extra to ship in the package, and Windows needs a
  // real image — an empty nativeImage leaves an invisible tray entry there.
  const icon = nativeImage.createFromDataURL(TRAY_ICON_16);
  icon.addRepresentation({ scaleFactor: 2, dataURL: TRAY_ICON_32 });
  tray = new Tray(icon);
  refreshTrayMenu();

  // Double-click is the habit for a tray app, so it opens the dashboard (or
  // setup, when there's nothing to show yet). Windows and macOS only — Linux
  // tray implementations deliver no click events at all, which is why every
  // action also lives in the menu above.
  tray.on('double-click', () => void (config ? showDashboard() : openSetup()));

  // Launching the agent again (Start menu, desktop shortcut) reads as "show me
  // the app" — the running instance answers instead of a second one starting.
  surfaceUi = () => void (config ? showDashboard() : openSetup());

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
