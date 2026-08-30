import { Platform } from 'react-native';
import { createAndroidHost } from './android.ts';
import { createElectronHost, hasElectronBridge } from './electron.ts';
import type { AgentHost } from './types.ts';
import { createUnsupportedHost } from './unsupported.ts';

export type {
  AgentHost,
  BackgroundState,
  HostCapabilities,
  HostInfo,
  KeepAliveState,
  SyncSummary,
} from './types.ts';

// Which shell is running this UI. Branched at runtime rather than through
// Metro's platform extensions, because every import in this app carries an
// explicit `.ts` — and an explicit extension is a file path, not a request
// Metro will try `.android.ts` variants of. The android module is therefore
// bundled for web too, which is safe: its native binding is lazy (see
// modules/usage-events/index.ts) and nothing calls it here.

export async function createHost(): Promise<AgentHost> {
  if (Platform.OS === 'android') return createAndroidHost();
  if (hasElectronBridge()) return createElectronHost();
  return createUnsupportedHost();
}
