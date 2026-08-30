import { describe, expect, it } from 'vitest';
import type { AgentHost, HostCapabilities } from './types.ts';
import { createUnsupportedHost } from './unsupported.ts';

// A plain browser has no agent behind it. The point of this host is that the
// screens still render: everything is off, and the calls that would need an
// agent say so rather than failing somewhere deeper.

describe('createUnsupportedHost', () => {
  it('reports no agent and no capability', () => {
    const host = createUnsupportedHost();

    expect(host.available).toBe(false);
    for (const [name, enabled] of Object.entries(host.capabilities)) {
      expect(`${name}=${enabled}`).toBe(`${name}=false`);
    }
  });

  it('omits the methods its capabilities disclaim', () => {
    const host = createUnsupportedHost();

    // AgentHost's optional methods are present iff the matching capability is
    // set; with every capability off, none of them may be here at all.
    const gated: Array<[keyof HostCapabilities, keyof AgentHost]> = [
      ['usageAccess', 'openUsageAccessSettings'],
      ['backgroundSync', 'backgroundState'],
      ['keepAlive', 'keepAliveState'],
      ['autostart', 'setAutostart'],
      ['revealLog', 'revealLog'],
      ['externalDashboard', 'openDashboard'],
    ];
    for (const [capability, method] of gated) {
      expect(host.capabilities[capability]).toBe(false);
      expect(host[method]).toBeUndefined();
    }
  });

  it('answers the read-only calls with empties instead of throwing', async () => {
    const host = createUnsupportedHost();

    expect(await host.loadConfig()).toBeNull();
    expect(await host.pendingCount()).toBe(0);
    expect(await host.readLog()).toBe('');
    expect(await host.usageAccessGranted()).toBe(false);
    await expect(host.clearLog()).resolves.toBeUndefined();
  });

  it('sends anyone trying to drive an agent to the desktop app', () => {
    const host = createUnsupportedHost();

    expect(() => host.saveConfig({} as never)).toThrow(/open the desktop app/);
    expect(() => host.syncNow()).toThrow(/open the desktop app/);
  });
});
