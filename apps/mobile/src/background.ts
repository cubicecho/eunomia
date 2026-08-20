import { type AgentConfig, syncIntervalMs } from '@eunomia/agent';
import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';
import { performSync } from './sync.ts';

// WorkManager-driven periodic sync so pings flow even when the app is closed.
// The OS treats the interval as a minimum — expect roughly hourly in practice,
// which is fine: the usage log is read retroactively, nothing is lost between
// runs. Imported from index.ts so defineTask runs on headless launches too.
//
// The configured sync interval only matters here when it is set LONGER than
// Android's 15-minute WorkManager floor; shorter intervals are honored by the
// foreground timer in StatusScreen instead.

const SYNC_TASK = 'eunomia-sync';
const MIN_BACKGROUND_MINUTES = 15;

TaskManager.defineTask(SYNC_TASK, async () => {
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
