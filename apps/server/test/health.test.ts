import { describe, expect, it } from 'vitest';
import { checkHealth, VERSION } from '../src/health.ts';
import { createMigratedTestDb } from './helpers/test-db.ts';

describe('health check', () => {
  it('reports ok with the build version when the database answers', async () => {
    const db = await createMigratedTestDb();
    expect(await checkHealth(db as never)).toEqual({ ok: true, version: VERSION });
  });

  it('reports the failure when the query throws', async () => {
    const broken = { execute: () => Promise.reject(new Error('connection refused')) };
    expect(await checkHealth(broken as never)).toEqual({
      ok: false,
      version: VERSION,
      error: 'connection refused',
    });
  });

  it('reads a real version out of package.json', async () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });
});
