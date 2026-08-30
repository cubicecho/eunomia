import {
  createSanitizer,
  createUploader,
  type Ping,
  synthesizePings,
  type UsageEvent,
} from '@eunomia/agent';
import UsageEvents, { type NativeUsageEvent } from '../modules/usage-events';
import { getOutbox, loadConfig, loadSyncState, writeSyncState } from './store.ts';

// One sync pass: read the OS usage log since the last checkpoint, synthesize
// the pings a live agent would have emitted (shared logic in @eunomia/agent),
// persist them to the outbox, then try to drain the outbox to the server.
// Safe to run offline or unprovisioned — pings just accumulate locally.

export interface SyncResult {
  synthesized: number;
  /** Pings still waiting in the outbox after the upload attempt. */
  pending: number;
  provisioned: boolean;
  /** Why the upload stopped, or null when it went through (or was skipped). */
  uploadError: string | null;
}

const labelCache = new Map<string, string | null>();

function appLabel(packageName: string): string | null {
  if (!labelCache.has(packageName)) {
    labelCache.set(packageName, UsageEvents.getAppLabel(packageName));
  }
  return labelCache.get(packageName) ?? null;
}

const launchableCache = new Map<string, boolean>();

/**
 * Whether a package is an app the user can open, cached for the process.
 *
 * Android has no "this one is a real app" event: UsageStatsManager logs an
 * ACTIVITY_RESUMED for anything that puts an activity on screen, so the log
 * carries the launcher between every pair of apps, the notification shade, a
 * permission dialog, an OEM's gesture overlay, a Play Services trampoline that
 * resumes and hands straight off. Nothing about the event says which is which
 * — but a launcher entry does, and it is the same question the app drawer
 * asks. See the native isLaunchable.
 */
function isUserApp(packageName: string): boolean {
  const known = launchableCache.get(packageName);
  if (known !== undefined) return known;
  const launchable = UsageEvents.isLaunchable(packageName);
  launchableCache.set(packageName, launchable);
  return launchable;
}

/**
 * Trades the package name for the name the launcher shows — "YouTube", not
 * `com.google.android.youtube`, since that is what the dashboard groups and
 * charts by.
 *
 * Deliberately after sanitizing: privacy patterns are documented to match the
 * app identifier (@eunomia/agent's privacy.ts), and a rule written against
 * `com.instagram` must not quietly stop ignoring an app because its label
 * changed. It also means a redacted app has already lost its title here.
 *
 * Falls back to the package when the label won't resolve — a package with no
 * launcher entry stays invisible to us even with the queries declaration in
 * plugins/with-package-visibility.js.
 */
function relabel(ping: Ping): Ping {
  if (!ping.app) return ping;
  return { ...ping, app: appLabel(ping.app) ?? ping.app };
}

function toUsageEvent(event: NativeUsageEvent): UsageEvent | null {
  switch (event.kind) {
    case 'foreground':
      if (!event.app) return null;
      // `app` stays the package name through synthesis and sanitization; the
      // human label is swapped in afterwards (see relabel below). The package
      // rides along in `title`, which is where the phone's closest equivalent
      // of a window title would go and keeps the stable identifier on record.
      return { at: event.at, kind: 'foreground', app: event.app, title: event.app };
    case 'screenOn':
    case 'screenOff':
      return { at: event.at, kind: event.kind };
  }
}

let syncing: Promise<SyncResult> | null = null;

/** Reentrancy-guarded: an overlapping call awaits the in-flight pass. */
export function performSync(): Promise<SyncResult> {
  syncing ??= syncOnce().finally(() => {
    syncing = null;
  });
  return syncing;
}

async function syncOnce(): Promise<SyncResult> {
  const outbox = getOutbox();
  const state = loadSyncState();
  const config = loadConfig();
  const now = Date.now();

  const events = UsageEvents.queryEvents(state.checkpoint, now)
    .map(toUsageEvent)
    .filter((e): e is UsageEvent => e !== null);
  const { pings, state: synth } = synthesizePings(state.synth, events, now);
  // Privacy rules apply before pings ever hit disk (see @eunomia/agent).
  const sanitize = createSanitizer(config ?? {});
  // On by default, and by omission: an install predating the setting means a
  // user who has never been asked, and the noise is worth more gone than kept.
  const appsOnly = config?.launchableAppsOnly !== false;
  const clean = pings
    .map(sanitize)
    .filter((p): p is Ping => p !== null)
    // Dropped after synthesis rather than before it, so the launcher's minutes
    // are not back-credited to the app the user left: the outgoing app's
    // closing ping still lands, and what happens next is nobody's. The server
    // accrues its 30s cap against the gap to whatever comes back — the same
    // small leak ignoreApps has always had, and the same reason it's capped.
    .filter((ping) => !appsOnly || !ping.app || isUserApp(ping.app))
    .map(relabel);

  // Outbox first, checkpoint second: a crash in between re-reads the same
  // window and duplicates some pings, which merely re-touch their activity —
  // the reverse order would silently drop the window.
  outbox.pushMany(clean);
  writeSyncState({ checkpoint: now, synth });

  let uploadError: string | null = null;
  if (config) {
    const uploader = createUploader(config, outbox);
    await uploader.flush();
    uploadError = uploader.status().error;
  }

  return {
    synthesized: clean.length,
    pending: outbox.size,
    provisioned: config !== null,
    uploadError,
  };
}
