import { type AgentConfig, syncIntervalMs } from '@eunomia/agent';
import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';
import { startFileLog } from './log.ts';
import { performSync } from './sync.ts';

// WorkManager-driven periodic sync so pings flow even when the app is closed.
// The OS treats the interval as a minimum — expect roughly hourly in practice,
// which is fine: the usage log is read retroactively, nothing is lost between
// runs. Imported from index.ts so defineTask runs on headless launches too.
//
// This is also the phone's answer to the desktop agent's "Start at login":
// WorkManager persists its registration across reboots, so an agent that is
// enrolled here keeps tracking without anyone opening the app. Turning it off
// is the same choice as clearing the login item, and lives in the same place —
// a toggle on the status screen.
//
// The configured sync interval only matters here when it is set LONGER than
// Android's 15-minute WorkManager floor; shorter intervals are honored by the
// foreground timer in StatusScreen instead.

const SYNC_TASK = 'eunomia-sync';
const MIN_BACKGROUND_MINUTES = 15;

TaskManager.defineTask(SYNC_TASK, async () => {
  // A headless launch runs this module and nothing else — without it a
  // background failure leaves no trace on the device at all.
  startFileLog();
  try {
    await performSync();
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch (error) {
    console.error('background sync failed', error);
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

export async function registerBackgroundSync(config: AgentConfig): Promise<void> {
  const minutes = Math.max(MIN_BACKGROUND_MINUTES, Math.round(syncIntervalMs(config) / 60_000));
  await BackgroundTask.registerTaskAsync(SYNC_TASK, { minimumInterval: minutes });
}

export async function unregisterBackgroundSync(): Promise<void> {
  // Unregistering a task that was never registered throws.
  if (await TaskManager.isTaskRegisteredAsync(SYNC_TASK)) {
    await BackgroundTask.unregisterTaskAsync(SYNC_TASK);
  }
}

/**
 * Applies the config's choice. Called on every config change, so it also picks
 * up a new sync interval — re-registering replaces the existing work.
 */
export async function applyBackgroundSync(config: BackgroundConfig): Promise<void> {
  // Default on: an agent that only tracks while you're looking at it mostly
  // measures looking at it.
  if (config.backgroundSync === false) await unregisterBackgroundSync();
  else await registerBackgroundSync(config);
}

export interface BackgroundConfig extends AgentConfig {
  /** Enrol in periodic background sync. Default true. */
  backgroundSync?: boolean;
}

export interface BackgroundState {
  registered: boolean;
  /** False when the OS won't run background work for this app at all. */
  available: boolean;
}

export async function backgroundState(): Promise<BackgroundState> {
  const [registered, status] = await Promise.all([
    TaskManager.isTaskRegisteredAsync(SYNC_TASK),
    BackgroundTask.getStatusAsync(),
  ]);
  return { registered, available: status === BackgroundTask.BackgroundTaskStatus.Available };
}
