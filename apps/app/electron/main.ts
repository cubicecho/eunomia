import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';
import {
  type AgentConfig,
  CHECK_INTERVAL_MS,
  createSampler,
  createSanitizer,
  createUploader,
  Outbox,
  type OutboxStore,
  type Sample,
  type Sampler,
  type StoredConfig,
  syncIntervalMs,
  type Uploader,
} from '@eunomia/agent';
import { activeWindow } from '@miniben90/x-win';
import { app, Menu, type MenuItem, nativeImage, powerMonitor, shell, Tray } from 'electron';
import { syncAutostart } from './autostart.ts';
import {
  isEnvConfigured,
  loadConfig,
  platformName,
  saveAutostart,
  writeAgentConfig,
} from './config.ts';
import { type AgentRuntime, registerAgentIpc } from './ipc.ts';
import { readLog, resetLog, startFileLog } from './log.ts';
import { registerAgentScheme, serveAgentBundle } from './protocol.ts';
import { TRAY_ICON_16, TRAY_ICON_32 } from './tray-icon.ts';
import { agentWindow, openAgentWindow } from './window.ts';

/**
 * The agent's version. `app.getVersion()` reads the package.json at the app
 * path: apps/app/package.json in a packaged build, but the dev-only
 * electron/package.json when running from source — and that one exists solely
 * to make `electron ./electron` work, so it has no version to give.
 */
function agentVersion(): string {
  if (app.isPackaged) return app.getVersion();
  try {
    const text = readFileSync(join(app.getAppPath(), '..', 'package.json'), 'utf8');
    return (JSON.parse(text) as { version?: string }).version ?? app.getVersion();
  } catch {
    return app.getVersion();
  }
}

// Tray-only background agent. Stateless by design: it observes the foreground
// window + idle time and emits pings ("this is what the device looks like right
// now"); the server folds pings into activity intervals, so the agent never
// tracks sessions itself.
//
// Outbox durability, batching, the sampling loop and the server calls live in
// @eunomia/agent (shared with the Android agent); this file owns the electron
// shell: the platform reads the sampler drives, the tray, and the window the
// shared agent UI renders into. What that UI is allowed to ask for is ipc.ts;
// what it is told about this shell is `info()`.

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

/**
 * The window object the last read produced. The sampler calls readContext for
 * the sample it has just read, in the same tick, so holding it here is safe —
 * and it keeps the native handle out of the Sample crossing the package
 * boundary, where only the fields every platform can answer belong.
 */
let lastWindow: ReturnType<typeof activeWindow> | null = null;

/** Everything a tick can read cheaply. Throwing is how the OS says "not now". */
function readSample(): Sample {
  const win = activeWindow();
  lastWindow = win;
  return {
    app: win?.info?.execName || null,
    title: win?.title || null,
    idleSeconds: powerMonitor.getSystemIdleTime(),
  };
}

const readContext = (sample: Sample): string | null =>
  lastWindow ? browserContext(lastWindow, sample.app) : null;

/** "3s" / "4m" / "2h" — how long ago, for a tray line nobody wants to parse. */
function ago(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  return `${Math.round(seconds / 3600)}h ago`;
}

/**
 * How often the tray menu is rebuilt. The OS reads whatever template was set
 * last, so an agent that stopped tracking an hour ago would otherwise still be
 * showing the line it had when the last upload finished.
 */
const TRAY_REFRESH_MS = 30_000;

// One agent per machine. A second instance would sample in parallel and share
// outbox.jsonl, where the outbox's compacting rewrite silently erases
// whatever the other instance queued in the meantime — so the second launch
// surfaces the first one's window and exits. `--provision` is a one-shot CLI
// that writes config.json and quits, so it stays allowed alongside the tray.
// Pinned rather than inherited from package.json's name, which is now the
// Expo app's. userData is derived from it, so leaving it to the default would
// relocate an existing dev install's config.json, outbox and log — and the
// packaged builds set it through electron-builder's productName anyway.
app.setName('eunomia-agent');

// Must precede whenReady: chromium reads the scheme registry during startup.
registerAgentScheme();

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

  // Sampling starts before anything else: an unprovisioned agent still tracks
  // to its outbox, and its health is the one thing the tray must never guess
  // at. `sanitize` is read per tick so a privacy change applies immediately.
  const sampler: Sampler = createSampler({
    outbox,
    read: readSample,
    readContext,
    sanitize: () => sanitize,
  });

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

  // A finished setup, arriving from the agent window: onboarding while
  // unprovisioned, or the "change server / API key" flow once provisioned.
  // Everything the new config touches is swapped in place — the agent is never
  // restarted, and anything already queued goes up to the new server.
  const applyConfig = (next: StoredConfig): void => {
    writeAgentConfig(dataDir, next);
    config = next;
    sanitize = createSanitizer(next);
    syncAutostart(next.autostart !== false);
    startUploads(next);
    refreshTrayMenu();
  };

  // Dashboard window: the server-hosted web app, signed in via the device
  // key. Lazily imported like setup — the hot path never loads it.
  const showDashboard = async (): Promise<void> => {
    if (!config) return;
    const { openDashboard } = await import('./dashboard.ts');
    await openDashboard(config);
  };

  // The question the tray could never answer: is it actually tracking? It used
  // to say "tracking active window" unconditionally, so a sampler throwing on
  // every tick — a native module that didn't unpack, an accessibility API that
  // stopped answering — looked exactly like a healthy agent with a quiet day.
  const trackingLabel = (): string => {
    const status = sampler.status();
    if (!status.error && status.lastPingAt === null) return 'Tracking — nothing recorded yet';
    if (!status.healthy) return `NOT TRACKING: ${status.error}`;
    const last = status.lastPingAt === null ? 'never' : ago(Date.now() - status.lastPingAt);
    return `Tracking active window — last ping ${last}`;
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

  // Launch at login, toggled from the tray: registers or clears the login item
  // now (Windows/macOS) or the XDG autostart entry (Linux), and remembers the
  // choice for the next start. Running from source only remembers it —
  // syncAutostart leaves login items alone unless the app is packaged.
  const setAutostart = (enabled: boolean): void => {
    if (config) config = { ...config, autostart: enabled };
    saveAutostart(dataDir, enabled);
    syncAutostart(enabled);
    refreshTrayMenu();
  };

  // Not tracking outranks not uploading: a queued ping is recoverable, a
  // second nobody sampled is gone.
  const tooltip = (): string => {
    if (!sampler.status().healthy) return 'eunomia — NOT TRACKING (see the log)';
    if (uploader?.status().error) return 'eunomia — tracking, but uploads are failing';
    return 'eunomia — tracking active window';
  };

  const refreshTrayMenu = (): void => {
    tray?.setToolTip(tooltip());
    tray?.setContextMenu(
      Menu.buildFromTemplate([
        { label: `eunomia agent ${agentVersion()}`, enabled: false },
        { label: trackingLabel(), enabled: false },
        { label: uploadLabel(), enabled: false },
        { label: `Outbox: ${join(dataDir, 'outbox.jsonl')}`, enabled: false },
        ...(config
          ? [
              { label: 'Open Dashboard', click: () => void showDashboard() },
              { label: 'Change server / API key…', click: () => void openAgentWindow() },
              {
                // Only offered once provisioned — that's also the only case
                // where the agent registers a login item at startup, so an
                // unprovisioned tray would be showing a checkbox for something
                // that isn't happening. Setup has the same toggle.
                label: 'Start at login',
                type: 'checkbox' as const,
                // Default on: a tracker that has to be started by hand mostly
                // measures forgetting to start it.
                checked: config.autostart !== false,
                click: (item: MenuItem) => setAutostart(item.checked),
              },
            ]
          : [{ label: 'Set up uploads…', click: () => void openAgentWindow() }]),
        // Duplicated by the agent window's log screen, and kept: on Linux the
        // tray is the only surface that reliably answers a click.
        // showItemInFolder rather than openPath — .log often has no handler.
        { label: 'Show log file…', click: () => shell.showItemInFolder(logPath) },
        { type: 'separator' as const },
        { label: 'Quit', click: () => app.quit() },
      ]),
    );
  };

  // What the agent window is allowed to ask for. Capabilities rather than a
  // platform name: the UI is shared with the Android agent, and the rows that
  // don't apply here — usage access, the background task, the keep-alive
  // service — are switched off by this object, not by a check in the screen.
  const runtime: AgentRuntime = {
    dataDir,
    logPath,
    info: () => ({
      available: true,
      capabilities: {
        usageAccess: false,
        // The tray agent samples and uploads on its own schedule; a timer in
        // the renderer would only duplicate its flushes.
        foregroundSync: false,
        backgroundSync: false,
        keepAlive: false,
        autostart: true,
        revealLog: true,
        // OTA updates are Expo's, and they'd replace the renderer under a main
        // process the store never shipped. Desktop updates ship as a build.
        updates: false,
        externalDashboard: true,
      },
      version: agentVersion(),
      platform: platformName(),
      defaultDeviceName: hostname(),
      outboxPath: join(dataDir, 'outbox.jsonl'),
      logPath,
      envConfigured: isEnvConfigured(),
    }),
    loadConfig: () => config,
    applyConfig,
    // status() over outbox.size where there is an uploader: same number, but
    // it's the one the tray is showing, so the two can't disagree.
    pendingCount: () => uploader?.status().pending ?? outbox.size,
    flush: async () => {
      await uploader?.flush();
      refreshTrayMenu();
      const status = uploader?.status();
      return { pending: status?.pending ?? outbox.size, uploadError: status?.error ?? null };
    },
    readLog: () => readLog(logPath),
    clearLog: () => resetLog(logPath),
    setAutostart,
    openDashboard: showDashboard,
  };
  registerAgentIpc(runtime, agentWindow);
  serveAgentBundle();

  // Data-URL icon: nothing extra to ship in the package, and Windows needs a
  // real image — an empty nativeImage leaves an invisible tray entry there.
  const icon = nativeImage.createFromDataURL(TRAY_ICON_16);
  icon.addRepresentation({ scaleFactor: 2, dataURL: TRAY_ICON_32 });
  tray = new Tray(icon);
  refreshTrayMenu();

  // Double-click is the habit for a tray app, so it opens the dashboard (or
  // the agent window, when there's nothing to show yet). Windows and macOS
  // only — Linux tray implementations deliver no click events at all, which is
  // why every action also lives in the menu above.
  tray.on('double-click', () => void (config ? showDashboard() : openAgentWindow()));

  // Launching the agent again (Start menu, desktop shortcut) reads as "show me
  // the app" — the running instance answers instead of a second one starting.
  surfaceUi = () => void (config ? showDashboard() : openAgentWindow());

  setInterval(() => sampler.tick(), CHECK_INTERVAL_MS);
  // The OS shows whatever template was last set, so the tray's answer to "is
  // it tracking?" has to be kept fresh on its own schedule rather than riding
  // along with the upload interval.
  setInterval(refreshTrayMenu, TRAY_REFRESH_MS);
  if (config) {
    startUploads(config);
  } else {
    console.log('eunomia agent pinging locally; opening setup window');
    void openAgentWindow();
  }
});

// Keep running when all windows are closed — there are no windows at all.
app.on('window-all-closed', () => {
  /* tray app: stay alive */
});
