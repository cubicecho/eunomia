import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLocalFeed } from '@eunomia/agent';
import { afterEach, describe, expect, it } from 'vitest';
import {
  type LocalApiStatus,
  localApiToken,
  localApiTokenPath,
  startLocalApi,
} from './local-api.ts';

// The socket half, over a real loopback port: the rules themselves are tested
// in @eunomia/agent's local-api.test.ts.

const dirs: string[] = [];
const closers: (() => void)[] = [];
afterEach(() => {
  for (const close of closers.splice(0)) close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const tempDir = () => {
  const dir = mkdtempSync(join(tmpdir(), 'eunomia-local-api-'));
  dirs.push(dir);
  return dir;
};

/** A port nothing is listening on right now. */
const freePort = () =>
  new Promise<number>((resolve) => {
    const probe = createServer().listen(0, '127.0.0.1', () => {
      const address = probe.address();
      probe.close(() => resolve(typeof address === 'object' && address ? address.port : 0));
    });
  });

function start(port: number, token: string) {
  const feed = createLocalFeed();
  return new Promise<{ feed: typeof feed; status: LocalApiStatus }>((resolve) => {
    const api = startLocalApi(
      { port },
      { feed, token, info: { hostname: 'test', version: '0.0.0' } },
      (status) => resolve({ feed, status }),
    );
    closers.push(api.close);
  });
}

describe('local API token', () => {
  it('is made once, private to this user, and kept', () => {
    const dir = tempDir();
    const token = localApiToken(dir);
    expect(token.length).toBeGreaterThanOrEqual(32);
    expect(localApiToken(dir)).toBe(token);
    if (process.platform !== 'win32') {
      expect(statSync(localApiTokenPath(dir)).mode & 0o777).toBe(0o600);
    }
  });
});

describe('local API listener', () => {
  it('answers on loopback with the token, and feeds what it is told', async () => {
    const port = await freePort();
    const token = localApiToken(tempDir());
    const { feed, status } = await start(port, token);
    expect(status.state).toBe('listening');

    const url = `http://127.0.0.1:${port}/v1/events`;
    const body = JSON.stringify({ kind: 'window', app: 'kitty', source: 'test' });
    expect((await fetch(url, { method: 'POST', body })).status).toBe(401);

    const ok = await fetch(url, {
      method: 'POST',
      body,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ accepted: 1 });
    expect(feed.sources()).toEqual([expect.objectContaining({ source: 'test', kind: 'window' })]);
  });

  it('reports a busy port instead of crashing the agent', async () => {
    const port = await freePort();
    const holder = createServer().listen(port, '127.0.0.1');
    closers.push(() => holder.close());
    await new Promise((resolve) => holder.once('listening', resolve));

    const { status } = await start(port, 'x'.repeat(32));
    expect(status).toEqual({ state: 'failed', port, error: expect.stringContaining('in use') });
  });

  it('does not listen when turned off', () => {
    const api = startLocalApi(
      { enabled: false },
      { feed: createLocalFeed(), token: 't', info: { hostname: 'h', version: 'v' } },
      () => {},
    );
    expect(api.status().state).toBe('disabled');
  });
});
