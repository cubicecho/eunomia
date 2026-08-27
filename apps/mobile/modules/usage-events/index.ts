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
}

export default requireNativeModule<UsageEventsModule>('UsageEvents');
