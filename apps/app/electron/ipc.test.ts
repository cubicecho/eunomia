import type { BrowserWindow, WebContents } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BRIDGE_METHODS } from '../src/host/bridge.ts';
import { type AgentRuntime, registerAgentIpc } from './ipc.ts';

// Two things about this file are load-bearing enough to pin down: it answers
// every channel the bridge declares, and it answers none of them for a frame
// that is not the agent window. The second is the only thing standing between
// a stray renderer and the config the device's API key lives in.

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (event: { sender: unknown }, ...args: unknown[]) => unknown>(),
  showItemInFolder: vi.fn(),
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (event: { sender: unknown }, ...args: unknown[]) => unknown) => {
      mocks.handlers.set(channel, fn);
    },
  },
  shell: { showItemInFolder: mocks.showItemInFolder },
}));

const agentSender = { id: 'agent' } as unknown as WebContents;
const fromAgent = { sender: agentSender };
const fromElsewhere = { sender: { id: 'somewhere else' } };

function stubRuntime() {
  return {
    dataDir: '/data',
    logPath: '/data/agent.log',
    info: vi.fn(() => ({ platform: 'linux' })),
    loadConfig: vi.fn(() => ({ serverUrl: 'https://eunomia.example', apiKey: 'k' })),
    applyConfig: vi.fn(),
    pendingCount: vi.fn(() => 3),
    flush: vi.fn(async () => ({ pending: 1, uploadError: 'offline' })),
    readLog: vi.fn(() => 'a line'),
    clearLog: vi.fn(),
    setAutostart: vi.fn(),
    openDashboard: vi.fn(async () => undefined),
  } satisfies AgentRuntime & Record<string, unknown>;
}

let runtime: ReturnType<typeof stubRuntime>;

/** The handler for one bridge method, as ipcMain received it. */
const handlerFor = (name: string) => {
  const fn = mocks.handlers.get(`agent:${name}`);
  if (!fn) throw new Error(`no handler registered for agent:${name}`);
  return fn;
};

beforeEach(() => {
  mocks.handlers.clear();
  mocks.showItemInFolder.mockClear();
  runtime = stubRuntime();
  const owner = () => ({ webContents: agentSender }) as BrowserWindow;
  registerAgentIpc(runtime as unknown as AgentRuntime, owner);
});

describe('registerAgentIpc', () => {
  it('registers exactly the channels the bridge declares', () => {
    expect([...mocks.handlers.keys()].sort()).toEqual(
      BRIDGE_METHODS.map((name) => `agent:${name}`).sort(),
    );
  });

  it('refuses every channel from a frame that is not the agent window', () => {
    for (const name of BRIDGE_METHODS) {
      expect(() => handlerFor(name)(fromElsewhere)).toThrow(
        `refused ${name} from a frame that is not the agent window`,
      );
    }
    // Nothing reached the runtime on the way to being refused.
    expect(runtime.loadConfig).not.toHaveBeenCalled();
    expect(runtime.applyConfig).not.toHaveBeenCalled();
    expect(mocks.showItemInFolder).not.toHaveBeenCalled();
  });

  it('refuses everything when there is no agent window at all', () => {
    mocks.handlers.clear();
    registerAgentIpc(runtime as unknown as AgentRuntime, () => undefined);
    for (const name of BRIDGE_METHODS) {
      expect(() => handlerFor(name)(fromAgent)).toThrow(/not the agent window/);
    }
  });

  it('passes the agent window through to the runtime', () => {
    expect(handlerFor('info')(fromAgent)).toEqual({ platform: 'linux' });
    expect(handlerFor('pendingCount')(fromAgent)).toBe(3);
    expect(handlerFor('readLog')(fromAgent)).toBe('a line');

    const config = { serverUrl: 'https://elsewhere.example', apiKey: 'k2' };
    handlerFor('saveConfig')(fromAgent, config);
    expect(runtime.applyConfig).toHaveBeenCalledWith(config);

    handlerFor('setAutostart')(fromAgent, true);
    expect(runtime.setAutostart).toHaveBeenCalledWith(true);
  });

  it('reveals the log rather than opening it — .log usually has no handler', () => {
    handlerFor('revealLog')(fromAgent);
    expect(mocks.showItemInFolder).toHaveBeenCalledWith('/data/agent.log');
  });

  it('reports a sync as a flush, with no synthesized count to claim', async () => {
    expect(await handlerFor('syncNow')(fromAgent)).toEqual({
      synthesized: null,
      pending: 1,
      provisioned: true,
      uploadError: 'offline',
    });
  });
});
