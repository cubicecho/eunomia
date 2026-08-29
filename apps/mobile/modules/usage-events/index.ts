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

export default requireNativeModule<UsageEventsModule>('UsageEvents');
