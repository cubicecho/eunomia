import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';
import { performSync } from './sync.ts';

// WorkManager-driven periodic sync so pings flow even when the app is closed.
// The OS treats the interval as a minimum — expect roughly hourly in practice,
// which is fine: the usage log is read retroactively, nothing is lost between
// runs. Imported from index.ts so defineTask runs on headless launches too.

const SYNC_TASK = 'eunomia-sync';

TaskManager.defineTask(SYNC_TASK, async () => {
  try {
    await performSync();
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch (error) {
    console.error('background sync failed', error);
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

export async function registerBackgroundSync(): Promise<void> {
  await BackgroundTask.registerTaskAsync(SYNC_TASK, { minimumInterval: 15 });
}
