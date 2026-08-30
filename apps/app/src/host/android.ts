import type { StoredConfig } from '@eunomia/agent';
import * as Application from 'expo-application';
import UsageEvents from '../../modules/usage-events';
import {
  applyBackgroundSync,
  applyKeepAlive,
  backgroundState,
  keepAliveState,
} from '../background.ts';
import { clearLog, logPath, readLog, startFileLog } from '../log.ts';
import { getOutbox, loadConfig, outboxPath, writeConfig } from '../store.ts';
import { performSync } from '../sync.ts';
import type { AgentHost } from './types.ts';

// The Android shell: the app IS the agent, so every call here is a local one.
// Persistence is the document directory, mirroring the desktop agent's
// userData layout — config.json, outbox.jsonl, sync-state.json, agent.log.

export function createAndroidHost(): AgentHost {
  // Idempotent, and the first thing the foreground does: a released build has
  // no console anyone can reach, so everything below this line only exists in
  // the log file. The headless launches start it themselves (background.ts).
  startFileLog();

  return {
    available: true,
    capabilities: {
      usageAccess: true,
      foregroundSync: true,
      backgroundSync: true,
      keepAlive: true,
      autostart: false,
      revealLog: false,
      updates: true,
      externalDashboard: false,
    },
    version: Application.nativeApplicationVersion,
    platform: 'android',
    defaultDeviceName: `${Application.applicationName ?? 'eunomia'} phone`,
    outboxPath: outboxPath(),
    logPath: logPath(),
    // Nothing on a phone supplies the connection from an environment.
    envConfigured: false,

    loadConfig: async () => loadConfig(),
    saveConfig: async (config: StoredConfig) => writeConfig(config),

    // The desktop agent applies a new config in its main process as it takes
    // the save; here the app is the agent, so the background enrolment and the
    // keep-alive service are re-applied from the same place the UI runs.
    applyConfig: async (config: StoredConfig) => {
      applyKeepAlive(config);
      await applyBackgroundSync(config);
    },

    pendingCount: async () => getOutbox().size,
    syncNow: () => performSync(),

    readLog: async () => readLog(),
    clearLog: async () => clearLog(),

    usageAccessGranted: async () => UsageEvents.isUsageAccessGranted(),
    openUsageAccessSettings: async () => UsageEvents.openUsageAccessSettings(),
    backgroundState: () => backgroundState(),
    keepAliveState: async () => keepAliveState(),
    requestNotificationPermission: async () => UsageEvents.requestNotificationPermission(),
    requestBatteryExemption: async () => UsageEvents.requestIgnoreBatteryOptimizations(),
  };
}
