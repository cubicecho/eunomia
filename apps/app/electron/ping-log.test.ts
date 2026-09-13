import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Outbox, type Ping } from '@eunomia/agent';
import { afterEach, describe, expect, it } from 'vitest';
import { pingLogDir, pingLogStore } from './ping-log.ts';

const ping = (n: number): Ping => ({
  capturedAt: new Date(n).toISOString(),
  app: `app${n}`,
  title: null,
  context: null,
  idleSeconds: 0,
});

const now = () => Date.parse('2026-09-13T12:00:00Z');

describe('pingLogStore', () => {
  let dataDir: string;
  afterEach(() => rmSync(dataDir, { recursive: true, force: true }));

  it('keeps day files and the cursor together under pings/', () => {
    dataDir = mkdtempSync(join(tmpdir(), 'eunomia-log-'));
    const outbox = new Outbox(pingLogStore(dataDir), { now });
    outbox.pushMany([ping(1), ping(2)]);
    outbox.drop(1);

    expect(readdirSync(pingLogDir(dataDir)).sort()).toEqual(['2026-09-13.jsonl', 'cursor.json']);
    expect(new Outbox(pingLogStore(dataDir), { now }).peek(5).map((p) => p.app)).toEqual(['app2']);
  });

  it('moves an old outbox.jsonl into the log', () => {
    dataDir = mkdtempSync(join(tmpdir(), 'eunomia-log-'));
    writeFileSync(join(dataDir, 'outbox.jsonl'), `${JSON.stringify(ping(1))}\n`);
    const outbox = new Outbox(pingLogStore(dataDir), { now });

    expect(outbox.size).toBe(1);
    expect(existsSync(join(dataDir, 'outbox.jsonl'))).toBe(false);
    expect(readFileSync(join(pingLogDir(dataDir), '2026-09-13.jsonl'), 'utf8')).toContain('app1');
  });
});
