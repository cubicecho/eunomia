import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createStaticHandler } from '../src/static.ts';

describe('static handler', () => {
  const root = mkdtempSync(join(tmpdir(), 'eunomia-static-'));
  const server = createServer(createStaticHandler(root));
  let base = '';

  beforeAll(async () => {
    writeFileSync(join(root, 'index.html'), '<html>app</html>');
    mkdirSync(join(root, 'assets'));
    writeFileSync(join(root, 'assets', 'main-abc123.js'), 'console.log(1)');
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(() => new Promise((resolve) => server.close(resolve)));

  it('serves hashed assets with immutable caching', async () => {
    const res = await fetch(`${base}/assets/main-abc123.js`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/javascript; charset=utf-8');
    expect(res.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(await res.text()).toBe('console.log(1)');
  });

  it('falls back to index.html for SPA routes like magic links', async () => {
    const res = await fetch(`${base}/?token=abc`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(res.headers.get('cache-control')).toBe('no-cache');
    expect(await res.text()).toBe('<html>app</html>');
  });

  it('never serves files outside the root', async () => {
    // A real file one level above the served directory must stay unreachable
    // through every encoding of "..": plain dots are normalized away by URL
    // parsing, encoded slashes only decode after path resolution's guard.
    writeFileSync(join(root, '..', 'secret.txt'), 'topsecret');
    for (const path of ['/../secret.txt', '/%2e%2e/secret.txt', '/..%2fsecret.txt']) {
      const res = await fetch(`${base}${path}`);
      expect(await res.text()).not.toContain('topsecret');
    }
  });

  it('rejects non-GET methods', async () => {
    const res = await fetch(`${base}/`, { method: 'POST' });
    expect(res.status).toBe(405);
  });
});
