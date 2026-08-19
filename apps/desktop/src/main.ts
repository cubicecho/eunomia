import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { activeWindow } from '@miniben90/x-win';
import { app, Menu, nativeImage, powerMonitor, Tray } from 'electron';
import type { AgentConfig } from './api.ts';

// Tray-only background agent. Stateless by design: it observes the foreground
// window + idle time and emits pings ("this is what the device looks like right
// now"); the server folds pings into activity intervals, so the agent never
// tracks sessions itself. It checks every second but only emits on focus/title
// change or every PING_INTERVAL_MS as a keep-alive — matching the server's
// fold tolerance (see apps/server/src/activity/fold.ts).
//
// Durability: every ping is appended to outbox.jsonl before anything else, and
// removed only after the server acknowledges it, so crashes and offline spells
// lose nothing. Uploads need a provisioned device API key (mint one with the
// registerDevice mutation); without config the agent just accumulates locally.

const CHECK_INTERVAL_MS = 1_000;
const PING_INTERVAL_MS = 10_000;
const FLUSH_INTERVAL_MS = 30_000;
const FLUSH_BATCH_SIZE = 50;

interface Ping {
  capturedAt: string;
  app: string | null;
  title: string | null;
  idleSeconds: number;
}

/** Env vars win; otherwise config.json in userData: {"serverUrl": ..., "apiKey": ...}. */
function loadConfig(dataDir: string): AgentConfig | null {
  const envUrl = process.env.EUNOMIA_SERVER_URL;
  const envKey = process.env.EUNOMIA_API_KEY;
  if (envUrl && envKey) return { serverUrl: envUrl, apiKey: envKey };

  const configPath = join(dataDir, 'config.json');
  if (!existsSync(configPath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(configPath, 'utf8')) as Partial<AgentConfig>;
    if (typeof parsed.serverUrl === 'string' && typeof parsed.apiKey === 'string') {
      return { serverUrl: parsed.serverUrl, apiKey: parsed.apiKey };
    }
  } catch (error) {
    console.error(`invalid ${configPath}`, error);
  }
  return null;
}

/** Crash-safe FIFO of pending pings, mirrored to a JSONL file. */
class Outbox {
  private queue: Ping[] = [];
  // No TS parameter properties: electron runs this file with strip-only
  // type stripping, which cannot rewrite them.
  private readonly path: string;

  constructor(path: string) {
    this.path = path;
    if (existsSync(path)) {
      this.queue = readFileSync(path, 'utf8')
        .split('\n')
        .filter(Boolean)
        .flatMap((line) => {
          try {
            return [JSON.parse(line) as Ping];
          } catch {
            return []; // torn write from a crash mid-append
          }
        });
    }
  }

  push(ping: Ping): void {
    this.queue.push(ping);
    appendFileSync(this.path, `${JSON.stringify(ping)}\n`);
  }

  peek(count: number): Ping[] {
    return this.queue.slice(0, count);
  }

  drop(count: number): void {
    this.queue.splice(0, count);
    writeFileSync(this.path, this.queue.map((p) => `${JSON.stringify(p)}\n`).join(''));
  }

  get size(): number {
    return this.queue.length;
  }
}

/**
 * Uploads a batch as one request of aliased recordPing calls — GraphQL runs
 * root mutation fields serially, which the server's fold logic relies on. The
 * device is inferred server-side from the API key. Returns true if the server
 * processed the batch (even with per-ping errors: those pings are dropped
 * rather than retried forever); false on network/auth failure (retry later).
 */
async function uploadBatch(config: AgentConfig, batch: Ping[]): Promise<boolean> {
  const vars: Record<string, unknown> = {};
  const defs: string[] = [];
  const fields: string[] = [];
  batch.forEach((ping, i) => {
    defs.push(`$c${i}: String!, $a${i}: String, $t${i}: String, $i${i}: Int!`);
    fields.push(
      `p${i}: recordPing(capturedAt: $c${i}, app: $a${i}, title: $t${i}, idleSeconds: $i${i}) { id }`,
    );
    vars[`c${i}`] = ping.capturedAt;
    vars[`a${i}`] = ping.app;
    vars[`t${i}`] = ping.title;
    vars[`i${i}`] = ping.idleSeconds;
  });

  try {
    const response = await fetch(new URL('/graphql', config.serverUrl), {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': config.apiKey },
      body: JSON.stringify({
        query: `mutation (${defs.join(', ')}) { ${fields.join(' ')} }`,
        variables: vars,
      }),
    });
    if (!response.ok) {
      console.error(`upload failed: HTTP ${response.status}`);
      return false;
    }
    const body = (await response.json()) as { data?: unknown; errors?: { message: string }[] };
    if (body.errors?.length) console.error('upload partial errors', body.errors);
    // data present (even partially null) means the server ran the mutations.
    return body.data !== undefined && body.data !== null;
  } catch (error) {
    console.error('upload failed', error);
    return false;
  }
}

let tray: Tray | undefined;
let lastEmit = { app: null as string | null, title: null as string | null, at: 0 };
let flushing = false;

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

async function flushOnce(config: AgentConfig, outbox: Outbox): Promise<void> {
  if (flushing) return;
  flushing = true;
  try {
    while (outbox.size > 0) {
      const batch = outbox.peek(FLUSH_BATCH_SIZE);
      if (!(await uploadBatch(config, batch))) return; // offline — retry next tick
      outbox.drop(batch.length);
    }
  } finally {
    flushing = false;
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

  const outbox = new Outbox(join(dataDir, 'outbox.jsonl'));
  let config = loadConfig(dataDir);

  const startUploads = (cfg: AgentConfig): void => {
    setInterval(() => void flushOnce(cfg, outbox), FLUSH_INTERVAL_MS);
    void flushOnce(cfg, outbox); // drain whatever a previous run left behind
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
