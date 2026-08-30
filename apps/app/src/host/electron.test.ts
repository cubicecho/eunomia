import type { StoredConfig } from '@eunomia/agent';
import { describe, expect, it } from 'vitest';
import { type AgentBridge, BRIDGE_METHODS } from './bridge.ts';
import { createElectronHost, hasElectronBridge } from './electron.ts';
import type { HostInfo } from './types.ts';

// The renderer half of the desktop shell. What is worth pinning here is the
// forwarding itself: every name in BRIDGE_METHODS has to survive the trip from
// the AgentHost the screens call to the `agent:` channel ipc.ts answers, and a
// method silently dropped in the spread would only surface as a dead button.

const info: HostInfo = {
  available: true,
  capabilities: {
    usageAccess: false,
    foregroundSync: false,
    backgroundSync: false,
    keepAlive: false,
    autostart: true,
    revealLog: true,
    updates: false,
    externalDashboard: true,
  },
  version: '0.1.0',
  platform: 'linux',
  defaultDeviceName: 'desk',
  outboxPath: '/data/outbox',
  logPath: '/data/agent.log',
  envConfigured: false,
};

/** A bridge that answers every method and records what it was asked. */
function fakeBridge() {
  const calls: Array<[string, unknown[]]> = [];
  const bridge = Object.fromEntries(
    BRIDGE_METHODS.map((name) => [
      name,
      (...args: unknown[]) => {
        calls.push([name, args]);
        return Promise.resolve(name === 'info' ? info : null);
      },
    ]),
  ) as unknown as AgentBridge;
  return { bridge, calls };
}

/** Every method the host forwards — `info` is consumed at construction. */
type Forwarded = Exclude<(typeof BRIDGE_METHODS)[number], 'info'>;
const forwarded = BRIDGE_METHODS.filter((name): name is Forwarded => name !== 'info');

describe('hasElectronBridge', () => {
  it('is false in a browser, where the preload never ran', () => {
    globalThis.eunomia = undefined;
    expect(hasElectronBridge()).toBe(false);
  });

  it('is true once the preload has exposed the bridge', () => {
    globalThis.eunomia = fakeBridge().bridge;
    expect(hasElectronBridge()).toBe(true);
  });
});

describe('createElectronHost', () => {
  it('takes its facts from the main process', async () => {
    globalThis.eunomia = fakeBridge().bridge;
    const host = await createElectronHost();

    expect(host.version).toBe('0.1.0');
    expect(host.platform).toBe('linux');
    expect(host.defaultDeviceName).toBe('desk');
    expect(host.capabilities.externalDashboard).toBe(true);
  });

  it('forwards every bridge method to its namesake', async () => {
    const { bridge, calls } = fakeBridge();
    globalThis.eunomia = bridge;
    const host = (await createElectronHost()) as unknown as Record<
      Forwarded,
      () => Promise<unknown>
    >;

    for (const name of forwarded) {
      calls.length = 0;
      await host[name]();
      expect(calls.map(([called]) => called)).toEqual([name]);
    }
  });

  it('carries the arguments of the two methods that take any', async () => {
    const { bridge, calls } = fakeBridge();
    globalThis.eunomia = bridge;
    const host = await createElectronHost();

    const config: StoredConfig = { serverUrl: 'https://eunomia.example', apiKey: 'k' };
    calls.length = 0;
    await host.saveConfig(config);
    await host.setAutostart?.(true);

    expect(calls).toEqual([
      ['saveConfig', [config]],
      ['setAutostart', [true]],
    ]);
  });

  it('grants usage access without asking: the desktop has no such permission', async () => {
    const { bridge, calls } = fakeBridge();
    globalThis.eunomia = bridge;
    const host = await createElectronHost();

    calls.length = 0;
    expect(await host.usageAccessGranted()).toBe(true);
    expect(calls).toEqual([]);
  });
});
