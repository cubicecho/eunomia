import { describe, expect, it } from 'vitest';
import { createLocalFeed, hostOf, parseReport } from './local-feed.ts';
import type { Ping } from './ping.ts';
import { createSanitizer } from './privacy.ts';

const T0 = Date.parse('2026-10-18T12:00:00Z');

function clock() {
  let at = T0;
  return { now: () => at, advance: (ms: number) => (at += ms) };
}

const native =
  (over: Partial<{ app: string | null; title: string | null; idleSeconds: number }> = {}) =>
  () => ({ app: 'code', title: 'main.ts — eunomia', idleSeconds: 3, ...over });

const ping = (over: Partial<Ping> = {}): Ping => ({
  capturedAt: new Date(T0).toISOString(),
  app: 'firefox',
  title: 'Pull requests · GitHub — Mozilla Firefox',
  context: null,
  idleSeconds: 0,
  ...over,
});

describe('local feed', () => {
  it('passes the native sample through when nothing has reported', () => {
    const feed = createLocalFeed(clock());
    expect(feed.sample(native())).toEqual({
      app: 'code',
      title: 'main.ts — eunomia',
      idleSeconds: 3,
    });
    expect(feed.enrich(ping())).toEqual(ping());
  });

  it('lets a fresh window report stand in for the platform, and stops when it expires', () => {
    const time = clock();
    const feed = createLocalFeed(time);
    feed.report(
      { kind: 'window', app: 'org.gnome.Nautilus', title: 'Home' },
      { source: 'awatcher', ttlSeconds: 5 },
    );

    expect(feed.sample(native())).toMatchObject({
      app: 'org.gnome.Nautilus',
      title: 'Home',
      idleSeconds: 3,
    });
    time.advance(5_000);
    expect(feed.sample(native())).toMatchObject({ app: 'code' });
  });

  it('forgives a platform that cannot read the window while a report covers it', () => {
    const time = clock();
    const feed = createLocalFeed(time);
    const broken = () => {
      throw new Error('no focused window on Wayland');
    };
    expect(() => feed.sample(broken)).toThrow('Wayland');

    feed.report({ kind: 'window', app: 'kitty', title: null });
    expect(feed.sample(broken)).toEqual({ app: 'kitty', title: null, idleSeconds: 0 });
  });

  it('takes idle time from an afk report: since the last input when away, none when present', () => {
    const time = clock();
    const feed = createLocalFeed(time);
    feed.report({ kind: 'afk', afk: true, since: T0 - 200_000 }, { ttlSeconds: 60 });
    expect(feed.sample(native({ idleSeconds: 0 })).idleSeconds).toBe(200);

    time.advance(1_000);
    feed.report({ kind: 'afk', afk: false }, { ttlSeconds: 60 });
    expect(feed.sample(native({ idleSeconds: 900 })).idleSeconds).toBe(0);
  });

  it('keeps the newer report when an older one arrives late', () => {
    const feed = createLocalFeed(clock());
    feed.report({ kind: 'window', app: 'new' }, { at: T0 });
    feed.report({ kind: 'window', app: 'old' }, { at: T0 - 1 });
    expect(feed.sample(native()).app).toBe('new');
  });

  it('ignores a report that expired before it arrived, and caps a long one', () => {
    const time = clock();
    const feed = createLocalFeed(time);
    feed.report({ kind: 'window', app: 'stale' }, { at: T0 - 60_000, ttlSeconds: 10 });
    expect(feed.sources()).toEqual([]);

    feed.report({ kind: 'window', app: 'forever' }, { ttlSeconds: 86_400 });
    time.advance(301_000);
    expect(feed.sources()).toEqual([]);
  });

  it('gives a browser ping the focused tab’s host, never more of the URL', () => {
    const feed = createLocalFeed(clock());
    feed.report({
      kind: 'browser',
      url: 'https://github.com/cubicecho/eunomia/pulls?q=token%3Dsecret',
      title: 'Pull requests',
      browser: 'firefox',
    });
    expect(feed.enrich(ping())).toEqual(ping({ context: 'github.com' }));
    // Not a browser in front: the tab is irrelevant.
    expect(feed.enrich(ping({ app: 'code' }))).toEqual(ping({ app: 'code' }));
  });

  it('uses the tab title only when the window title is unreadable', () => {
    const feed = createLocalFeed(clock());
    feed.report({ kind: 'browser', url: 'https://example.com/', title: 'Example' });
    expect(feed.enrich(ping({ title: null }))).toMatchObject({
      title: 'Example',
      context: 'example.com',
    });
  });

  it('strips everything about a private window, including the window title the platform read', () => {
    const feed = createLocalFeed(clock());
    feed.report({
      kind: 'browser',
      url: 'https://secret.example/',
      title: 'Secret',
      incognito: true,
    });
    expect(feed.enrich(ping())).toEqual(ping({ title: null, context: null }));
  });

  it('picks the report from the browser that is in front when two report', () => {
    const feed = createLocalFeed(clock());
    feed.report(
      { kind: 'browser', url: 'https://chrome.example/', browser: 'chrome' },
      { source: 'chrome', at: T0 },
    );
    feed.report(
      { kind: 'browser', url: 'https://ff.example/', browser: 'firefox' },
      { source: 'ff', at: T0 - 1 },
    );
    feed.report(
      { kind: 'browser', url: 'https://unfocused.example/', focused: false },
      { source: 'x', at: T0 },
    );

    expect(feed.enrich(ping({ app: 'firefox' })).context).toBe('ff.example');
    expect(feed.enrich(ping({ app: 'chrome' })).context).toBe('chrome.example');
  });

  it('still answers to the sanitizer: a lower capture level drops what the feed added', () => {
    const feed = createLocalFeed(clock());
    feed.report({ kind: 'browser', url: 'https://github.com/', title: 'GitHub' });
    const appOnly = createSanitizer({ captureLevel: 'app' });
    expect(appOnly(feed.enrich(ping({ title: null })))).toMatchObject({
      title: null,
      context: null,
    });
  });
});

describe('hostOf', () => {
  it('reads web hosts only', () => {
    expect(hostOf('https://Docs.Example.com/a?b')).toBe('docs.example.com');
    expect(hostOf('about:blank')).toBeNull();
    expect(hostOf('file:///home/me/notes.txt')).toBeNull();
    expect(hostOf('not a url')).toBeNull();
    expect(hostOf(null)).toBeNull();
  });
});

describe('parseReport', () => {
  it('accepts the three kinds and normalizes them', () => {
    expect(parseReport({ kind: 'window', app: ' code ' })).toEqual({
      kind: 'window',
      app: 'code',
      title: null,
    });
    expect(parseReport({ kind: 'afk', afk: true, since: '2026-10-18T11:00:00Z' })).toEqual({
      kind: 'afk',
      afk: true,
      since: Date.parse('2026-10-18T11:00:00Z'),
    });
    expect(parseReport({ kind: 'browser', url: 'https://a.example/' })).toEqual({
      kind: 'browser',
      url: 'https://a.example/',
      title: null,
      browser: null,
      incognito: false,
      focused: true,
    });
  });

  it('explains what is wrong with a bad report', () => {
    expect(parseReport(null)).toMatch(/object/);
    expect(parseReport({ kind: 'mouse' })).toMatch(/kind/);
    expect(parseReport({ kind: 'window', app: '' })).toMatch(/app/);
    expect(parseReport({ kind: 'window', app: 'x', title: 3 })).toMatch(/title/);
    expect(parseReport({ kind: 'afk', afk: 'yes' })).toMatch(/afk/);
    expect(parseReport({ kind: 'afk', afk: true, since: 'later' })).toMatch(/since/);
    expect(parseReport({ kind: 'browser', incognito: 'no' })).toMatch(/incognito/);
  });
});
