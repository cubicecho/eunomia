import { describe, expect, it } from 'vitest';
import { createLocalApi, type LocalRequest } from './local-api.ts';
import { createLocalFeed } from './local-feed.ts';

const T0 = Date.parse('2026-10-18T12:00:00Z');
const TOKEN = 'local-secret-token';

function setup(activityWatch = true) {
  const now = () => T0;
  const feed = createLocalFeed({ now });
  const api = createLocalApi({
    feed,
    token: TOKEN,
    port: 5600,
    activityWatch,
    info: { hostname: 'laptop', version: '0.1.0', deviceId: 'dev-1' },
    now,
  });
  const call = (
    method: string,
    url: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ) =>
    api.handle({
      method,
      url,
      headers: { host: '127.0.0.1:5600', authorization: `Bearer ${TOKEN}`, ...headers },
      body: body === undefined ? '' : typeof body === 'string' ? body : JSON.stringify(body),
    } satisfies LocalRequest);
  const sample = () => feed.sample(() => ({ app: 'native', title: 'native', idleSeconds: 1 }));
  return { feed, call, sample };
}

describe('local API guards', () => {
  it('refuses a missing or wrong token', () => {
    const { call } = setup();
    expect(call('GET', '/v1/status', undefined, { authorization: '' }).status).toBe(401);
    expect(call('GET', '/v1/status', undefined, { authorization: 'Bearer nope' }).status).toBe(401);
    expect(call('GET', '/v1/status', undefined, { authorization: TOKEN }).status).toBe(401);
    expect(call('GET', '/v1/status').status).toBe(200);
  });

  it('answers loopback hosts only, which is what stops DNS rebinding', () => {
    const { call } = setup();
    expect(call('GET', '/v1/status', undefined, { host: 'evil.example:5600' }).status).toBe(403);
    expect(call('GET', '/v1/status', undefined, { host: '127.0.0.1:9999' }).status).toBe(403);
    expect(call('GET', '/v1/status', undefined, { host: 'localhost:5600' }).status).toBe(200);
    expect(call('GET', '/v1/status', undefined, { host: '[::1]:5600' }).status).toBe(200);
  });

  it('refuses web pages but lets extensions in, with CORS for them', () => {
    const { call } = setup();
    expect(
      call('POST', '/v1/events', { kind: 'window', app: 'x' }, { origin: 'https://evil.example' })
        .status,
    ).toBe(403);

    const preflight = call('OPTIONS', '/v1/events', undefined, {
      origin: 'moz-extension://abc-123',
      authorization: '',
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers['access-control-allow-origin']).toBe('moz-extension://abc-123');
    expect(preflight.headers['access-control-allow-headers']).toContain('authorization');

    const real = call('GET', '/v1/status', undefined, { origin: 'chrome-extension://abcdef' });
    expect(real.status).toBe(200);
    expect(real.headers['access-control-allow-origin']).toBe('chrome-extension://abcdef');
  });
});

describe('/v1/events', () => {
  it('holds one report, a list, or {events}', () => {
    const { call, sample, feed } = setup();
    expect(
      call('POST', '/v1/events', { kind: 'window', app: 'kitty', source: 'hook' }).body,
    ).toEqual({ accepted: 1 });
    expect(sample().app).toBe('kitty');

    expect(
      call('POST', '/v1/events', [
        { kind: 'afk', afk: true, since: '2026-10-18T11:55:00Z' },
        { kind: 'browser', url: 'https://a.example/' },
      ]).body,
    ).toEqual({ accepted: 2 });
    expect(call('POST', '/v1/events', { events: [{ kind: 'window', app: 'y' }] }).body).toEqual({
      accepted: 1,
    });

    expect(sample().idleSeconds).toBe(300);
    expect(
      feed
        .sources()
        .map((s) => s.kind)
        .sort(),
    ).toEqual(['afk', 'browser', 'window', 'window']);
  });

  it('rejects a batch with one bad event, holding none of it', () => {
    const { call, feed } = setup();
    const response = call('POST', '/v1/events', [
      { kind: 'window', app: 'ok' },
      { kind: 'window' },
    ]);
    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'event 1: window.app is required' });
    expect(feed.sources()).toEqual([]);

    expect(call('POST', '/v1/events', '{not json').status).toBe(400);
    expect(call('POST', '/v1/events', { kind: 'window', app: 'x', at: 'soon' }).status).toBe(400);
  });

  it('reports which sources are live', () => {
    const { call } = setup();
    call('POST', '/v1/events', { kind: 'window', app: 'x', source: 'shell', ttlSeconds: 30 });
    expect(call('GET', '/v1/status').body).toEqual({
      sources: [{ source: 'shell', kind: 'window', at: T0, expiresAt: T0 + 30_000 }],
    });
  });

  it('404s anything else', () => {
    const { call } = setup();
    expect(call('GET', '/v1/events').status).toBe(404);
    expect(call('GET', '/nope').status).toBe(404);
  });
});

describe('ActivityWatch subset', () => {
  it('answers info like aw-server, so watchers find their hostname', () => {
    const { call } = setup();
    expect(call('GET', '/api/0/info').body).toMatchObject({
      hostname: 'laptop',
      testing: false,
      device_id: 'dev-1',
    });
  });

  it('creates, lists and reports buckets, with 304 for one that exists', () => {
    const { call } = setup();
    const create = () =>
      call('POST', '/api/0/buckets/aw-watcher-window_laptop', {
        client: 'awatcher',
        type: 'currentwindow',
        hostname: 'laptop',
      });
    expect(create().status).toBe(200);
    expect(create().status).toBe(304);
    expect(Object.keys(call('GET', '/api/0/buckets/').body as object)).toEqual([
      'aw-watcher-window_laptop',
    ]);
    expect(call('GET', '/api/0/buckets/aw-watcher-window_laptop').body).toMatchObject({
      type: 'currentwindow',
    });
    expect(call('GET', '/api/0/buckets/missing').status).toBe(404);
  });

  it('turns awatcher window and afk heartbeats into the foreground and idle', () => {
    const { call, sample } = setup();
    call('POST', '/api/0/buckets/aw-watcher-window_laptop', { type: 'currentwindow' });
    call('POST', '/api/0/buckets/aw-watcher-afk_laptop', { type: 'afkstatus' });

    const window = call('POST', '/api/0/buckets/aw-watcher-window_laptop/heartbeat?pulsetime=2', {
      timestamp: new Date(T0).toISOString(),
      duration: 0,
      data: { app: 'org.gnome.Ptyxis', title: 'vim' },
    });
    expect(window.status).toBe(200);
    call('POST', '/api/0/buckets/aw-watcher-afk_laptop/heartbeat?pulsetime=185', {
      timestamp: new Date(T0 - 240_000).toISOString(),
      duration: 240,
      data: { status: 'afk' },
    });

    expect(sample()).toEqual({ app: 'org.gnome.Ptyxis', title: 'vim', idleSeconds: 240 });
  });

  it('turns aw-watcher-web heartbeats into the browser tab, private windows included', () => {
    const { call, feed } = setup();
    const beat = (data: object) =>
      call('POST', '/api/0/buckets/aw-watcher-web-firefox_laptop/heartbeat?pulsetime=80', {
        timestamp: new Date(T0).toISOString(),
        duration: 0,
        data,
      });
    call('POST', '/api/0/buckets/aw-watcher-web-firefox_laptop', { type: 'web.tab.current' });

    beat({ url: 'https://news.example/item?id=1', title: 'News', incognito: false, tabCount: 3 });
    const base = {
      capturedAt: '',
      app: 'firefox',
      title: 'News — Firefox',
      context: null,
      idleSeconds: 0,
    };
    expect(feed.enrich(base).context).toBe('news.example');

    beat({ url: 'https://private.example/', title: 'Private', incognito: true });
    expect(feed.enrich(base)).toMatchObject({ title: null, context: null });
  });

  it('infers a bucket from its first heartbeat after an agent restart', () => {
    const { call, sample } = setup();
    call('POST', '/api/0/buckets/aw-watcher-window_laptop/heartbeat?pulsetime=2', {
      timestamp: new Date(T0).toISOString(),
      duration: 0,
      data: { app: 'kitty', title: 'zsh' },
    });
    expect(sample().app).toBe('kitty');
    expect(call('GET', '/api/0/buckets/aw-watcher-window_laptop').body).toMatchObject({
      type: 'currentwindow',
    });
  });

  it('acknowledges inserted events and other watchers without acting on them', () => {
    const { call, feed } = setup();
    expect(call('POST', '/api/0/buckets/aw-watcher-vscode/events', [{ data: {} }]).status).toBe(
      200,
    );
    expect(call('GET', '/api/0/buckets/aw-watcher-vscode/events?limit=1').body).toEqual([]);
    expect(
      call('POST', '/api/0/buckets/aw-watcher-vscode/heartbeat?pulsetime=30', {
        timestamp: new Date(T0).toISOString(),
        duration: 0,
        data: { project: 'x', language: 'ts' },
      }).status,
    ).toBe(200);
    expect(call('GET', '/api/0/settings').body).toEqual({});
    expect(feed.sources()).toEqual([]);
    expect(call('POST', '/api/0/buckets/x/heartbeat', { nope: true }).status).toBe(400);
  });

  it('is off when configured off, and still needs the token when on', () => {
    expect(setup(false).call('GET', '/api/0/info').status).toBe(404);
    expect(setup().call('GET', '/api/0/info', undefined, { authorization: '' }).status).toBe(401);
  });
});
