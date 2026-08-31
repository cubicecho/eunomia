import { requireNativeModule } from 'expo-modules-core';

export type NativeUsageEventKind = 'foreground' | 'screenOn' | 'screenOff';

export interface NativeUsageEvent {
  /** ms epoch */
  at: number;
  kind: NativeUsageEventKind;
  /** Package name — set only for 'foreground' events. */
  app: string | null;
}

interface UsageEventsModule {
  isUsageAccessGranted(): boolean;
  openUsageAccessSettings(): void;
  queryEvents(beginMs: number, endMs: number): NativeUsageEvent[];
  getAppLabel(packageName: string): string | null;
  /** Whether the package has a launcher entry — an app the user can open. */
  isLaunchable(packageName: string): boolean;

  /**
   * Whether the keep-alive foreground service is up in this process. Reports
   * the fact, not the setting: after a force stop the setting is still on and
   * this is false.
   */
  isKeepAliveRunning(): boolean;
  /** Starts, stops, or (with a changed interval) restarts the service. */
  setKeepAlive(enabled: boolean, intervalSeconds: number): void;
  /** Android 13+ runtime permission. True below it — nothing to ask for. */
  hasNotificationPermission(): boolean;
  /** No-op when already granted; the result arrives as a system dialog. */
  requestNotificationPermission(): void;
  isIgnoringBatteryOptimizations(): boolean;
  /** Opens the system dialog. No-op when already exempt. */
  requestIgnoreBatteryOptimizations(): void;
}

// Bound on first use rather than at import. The Electron renderer and the web
// target bundle everything this app can reach, this file included, and
// requireNativeModule throws where there is no native module to require —
// which would take the whole bundle down before a screen ever rendered.
// Nothing off Android calls through here: the host's capabilities say so
// (src/host/types.ts).
let native: UsageEventsModule | undefined;

const UsageEvents = new Proxy({} as UsageEventsModule, {
  get(_target, property) {
    native ??= requireNativeModule<UsageEventsModule>('UsageEvents');
    const value = Reflect.get(native as object, property) as unknown;
    // Host functions off a native module still want their own receiver, and
    // the proxy is not it.
    return typeof value === 'function' ? value.bind(native) : value;
  },
});

export default UsageEvents;
