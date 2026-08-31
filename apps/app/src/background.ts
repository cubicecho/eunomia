import { type AgentConfig, type StoredConfig, syncIntervalMs } from '@eunomia/agent';
import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';
import { AppRegistry, Platform } from 'react-native';
import UsageEvents from '../modules/usage-events';
import type { BackgroundState, KeepAliveState } from './host/types.ts';
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

// Registered at module scope, and only on the platform that has the machinery
// to call it: this module is reachable from the web and Electron targets too
// (the agent UI is shared), where there is no WorkManager, no headless JS
// launch, and no AppRegistry.registerHeadlessTask to register with.
if (Platform.OS === 'android') {
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
}

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
export async function applyBackgroundSync(config: StoredConfig): Promise<void> {
  // Default on: an agent that only tracks while you're looking at it mostly
  // measures looking at it.
  if (config.backgroundSync === false) await unregisterBackgroundSync();
  else await registerBackgroundSync(config);
}

export async function backgroundState(): Promise<BackgroundState> {
  const [registered, status] = await Promise.all([
    TaskManager.isTaskRegisteredAsync(SYNC_TASK),
    BackgroundTask.getStatusAsync(),
  ]);
  return { registered, available: status === BackgroundTask.BackgroundTaskStatus.Available };
}

// The keep-alive service (modules/usage-events SyncForegroundService) is the
// stronger version of the same promise. WorkManager's registration survives a
// swipe-away and a reboot, but not a *force stop* — which is what several OEM
// battery managers do to an app they decide is idle, and after that nothing
// runs until someone opens the app by hand. A foreground service is the one
// thing those layers leave alone. It costs a permanent notification, so it is
// off by default and the toggle sits next to the background one.
//
// Its ticks run this task rather than a second copy of the sync: a headless
// task is how React Native runs JS with no UI attached, and the service starts
// the JS context itself when the process came back without one.

const KEEP_ALIVE_TASK = 'EunomiaKeepAliveSync';

if (Platform.OS === 'android') {
  AppRegistry.registerHeadlessTask(KEEP_ALIVE_TASK, () => async () => {
    // Same reason as the WorkManager task above: a headless launch runs this
    // module and nothing else.
    startFileLog();
    try {
      await performSync();
    } catch (error) {
      // Nothing to report a failure to — the service ticks again on the interval.
      console.error('keep-alive sync failed', error);
    }
  });
}

/**
 * Applies the config's choice, and the sync interval with it: unlike the
 * background task, the service honors the interval exactly, with no 15-minute
 * floor. Called on every config change (App.tsx).
 */
export function applyKeepAlive(config: StoredConfig): void {
  const seconds = Math.round(syncIntervalMs(config) / 1000);
  UsageEvents.setKeepAlive(config.keepAlive === true, seconds);
}

export function keepAliveState(): KeepAliveState {
  return {
    running: UsageEvents.isKeepAliveRunning(),
    notifications: UsageEvents.hasNotificationPermission(),
    batteryExempt: UsageEvents.isIgnoringBatteryOptimizations(),
  };
}
