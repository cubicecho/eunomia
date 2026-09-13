import { describe, expect, it } from 'vitest';
import {
  awHosts,
  awRecords,
  batches,
  bundleRecords,
  csvRecords,
  type ImportRecord,
  lines,
  parseAwExport,
  readText,
  rescueTimeRecords,
  runImport,
  type SendChunk,
  WarningTally,
} from './import.ts';

async function* pieces(...parts: string[]) {
  yield* parts;
}

const collect = async <T>(items: AsyncIterable<T>): Promise<T[]> => {
  const out: T[] = [];
  for await (const item of items) out.push(item);
  return out;
};

const gzip = async (text: string): Promise<Blob> =>
  new Response(new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))).blob();

describe('reading files', () => {
  it('splits lines across pieces, and CSV records only outside quotes', async () => {
    expect(await collect(lines(pieces('a\r\nb', 'c\n\n', 'd')))).toEqual(['a', 'bc', 'd']);
    expect(await collect(csvRecords(pieces('h1,h2\r\n1,"two\n', 'lines ""x"""\n\n3,4')))).toEqual([
      'h1,h2',
      '1,"two\nlines ""x"""',
      '3,4',
    ]);
  });

  it('gunzips whatever the file is called', async () => {
    const text = '{"a":1}\n{"b":2}\n';
    expect((await collect(readText(await gzip(text)))).join('')).toBe(text);
    expect((await collect(readText(new Blob([text])))).join('')).toBe(text);
  });

  it('reads the second pass of a bundle as only what it needs', async () => {
    const file = await gzip(
      [
        '{"format":"eunomia-export","version":1}',
        '{"type":"device","id":"d"}',
        '{"type":"summary","deviceId":"d"}',
        '{"type":"activity","deviceId":"d"}',
        '{"type":"ping","deviceId":"d"}',
        '{"type":"end","counts":{}}',
      ].join('\n'),
    );
    expect(await collect(bundleRecords(file, 1))).toHaveLength(6);
    expect((await collect(bundleRecords(file, 2))).map((r) => JSON.parse(r.text).type)).toEqual([
      'summary',
      'activity',
      'end',
    ]);
  });

  it('turns RescueTime’s JSON report into the CSV its export page gives', async () => {
    const report = {
      row_headers: ['Date', 'Time Spent (seconds)', 'Activity'],
      rows: [['2026-07-01T00:00:00', 60, 'Slack, "Inc."']],
    };
    expect(await collect(rescueTimeRecords(new Blob([JSON.stringify(report)])))).toEqual([
      'Date,Time Spent (seconds),Activity',
      '2026-07-01T00:00:00,60,"Slack, ""Inc."""',
    ]);
    expect(await collect(rescueTimeRecords(new Blob(['Date,Activity\n1,x\n'])))).toEqual([
      'Date,Activity',
      '1,x',
    ]);
  });
});

describe('activitywatch files', () => {
  const doc = JSON.stringify({
    buckets: {
      'aw-watcher-window_laptop': {
        type: 'currentwindow',
        hostname: 'laptop',
        events: [
          { timestamp: '2026-08-16T20:01:00Z', duration: 30, data: { app: 'b' } },
          { timestamp: '2026-08-16T20:00:00Z', duration: 60, data: { app: 'a' } },
        ],
      },
      'aw-watcher-afk_laptop': {
        type: 'afkstatus',
        hostname: 'laptop',
        events: [{ timestamp: '2026-08-16T20:00:30Z', duration: 90, data: { status: 'not-afk' } }],
      },
      'aw-watcher-web-firefox': {
        type: 'web.tab.current',
        hostname: 'unknown',
        events: [{ timestamp: '2026-08-16T20:00:10Z', duration: 5, data: { url: 'https://x.y' } }],
      },
      'aw-watcher-input_laptop': { type: 'os.hid.input', hostname: 'laptop', events: [{}] },
      'aw-watcher-window_desktop': { type: 'currentwindow', hostname: 'desktop', events: [] },
    },
  });

  it('lists machines and sends one’s events in time order behind a header', () => {
    const buckets = parseAwExport(doc);
    expect(awHosts(buckets)).toEqual([
      { hostname: 'laptop', windowEvents: 2, afk: true, web: true },
      { hostname: 'desktop', windowEvents: 0, afk: false, web: true },
    ]);
    const records = awRecords(buckets, 'laptop');
    expect(JSON.parse(records[0]!.text)).toEqual({ format: 'activitywatch', afk: true });
    expect(records.slice(1).map((r) => [JSON.parse(r.text).type, r.ms])).toEqual([
      ['currentwindow', 60_000],
      ['web.tab.current', 0],
      ['afkstatus', 0],
      ['currentwindow', 30_000],
    ]);
    expect(() => parseAwExport('{"nope":1}')).toThrow(/no buckets/);
    expect(() => parseAwExport('<html>')).toThrow(/not JSON/);
  });

  it('keeps a call to a bounded amount of screen time', async () => {
    const hour = 3_600_000;
    async function* records(): AsyncGenerator<ImportRecord> {
      for (let i = 0; i < 30; i++) yield { text: `e${i}`, ms: hour };
    }
    expect((await collect(batches(records()))).map((b) => b.length)).toEqual([12, 12, 6]);
  });
});

describe('running an import', () => {
  const chunk = (next: string | null, extra = {}) => ({
    next,
    accepted: 1,
    skipped: 0,
    pings: 0,
    restart: false,
    deviceIds: ['d1'],
    warnings: [],
    ...extra,
  });

  async function* many(n: number, prefix: string): AsyncGenerator<ImportRecord> {
    for (let i = 0; i < n; i++) yield { text: `${prefix}${i}` };
  }

  it('passes the cursor along, says done on the last call, and reads again when asked', async () => {
    const calls: Parameters<SendChunk>[0][] = [];
    const send: SendChunk = async (variables) => {
      calls.push(variables);
      if (calls.length === 2) return chunk('c2', { restart: true, warnings: ['Bad (×2)'] });
      if (variables.done && calls.length > 2) return chunk(null, { warnings: ['Bad'] });
      return chunk(`c${calls.length}`);
    };
    const progress: number[] = [];
    const result = await runImport(
      send,
      'BUNDLE',
      null,
      (pass) => many(pass === 1 ? 4500 : 10, `p${pass}-`),
      (p) => progress.push(p.pass),
    );
    expect(calls.map((c) => [c.records.length, c.cursor, c.done])).toEqual([
      [2000, null, false],
      [2000, 'c1', false],
      [10, 'c2', true],
    ]);
    expect(calls[2]!.records[0]).toBe('p2-0');
    expect(result).toEqual({
      accepted: 3,
      skipped: 0,
      pings: 0,
      deviceIds: ['d1'],
      warnings: ['Bad (×3)'],
    });
    expect(progress).toEqual([1, 1, 2]);
  });

  it('names the target on the first call only, and sends an empty file as one done call', async () => {
    const calls: Parameters<SendChunk>[0][] = [];
    const send: SendChunk = async (variables) => {
      calls.push(variables);
      return chunk(variables.done ? null : 'next');
    };
    const target = { newDeviceName: 'laptop', platform: 'linux' };
    await runImport(send, 'ACTIVITYWATCH', target, () => many(2001, 'e'));
    expect(calls.map((c) => [c.target, c.done])).toEqual([
      [target, false],
      [null, true],
    ]);

    calls.length = 0;
    await runImport(send, 'RESCUETIME', { deviceId: 'd1' }, () => many(0, 'e'));
    expect(calls).toEqual([
      { source: 'RESCUETIME', records: [], cursor: null, target: { deviceId: 'd1' }, done: true },
    ]);
  });

  it('adds up warnings across calls', () => {
    const tally = new WarningTally();
    tally.add(['A', 'B (×2)']);
    tally.add(['A (×4)', 'C (with parens) (×2)']);
    expect(tally.list()).toEqual(['A (×5)', 'B (×2)', 'C (with parens) (×2)']);
  });
});
