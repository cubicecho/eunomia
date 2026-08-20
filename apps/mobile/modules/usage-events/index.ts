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
}

export default requireNativeModule<UsageEventsModule>('UsageEvents');
