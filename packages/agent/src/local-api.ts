import { type LocalFeed, type LocalReport, parseReport } from './local-feed.ts';

// The agent's local API: how other capture sources on this machine — the
// browser extension, an ActivityWatch watcher, a shell hook — tell the agent
// what they see. Pure request → response, no sockets: the desktop shell owns
// the listener (electron/local-api.ts) and hands each request here, which is
// what lets every rule below be tested without a port.
//
// Who may call it:
// - Only this machine. The listener binds loopback, and the Host header must
//   name loopback too, so a web page that rebinds its own domain to 127.0.0.1
//   still can't reach it.
// - Only something holding the token. It lives in the agent's data directory,
//   readable by this user alone, so "can read the token" means "already runs
//   as this user". Both ActivityWatch clients (aw-client-js, aw-client-rust)
//   send one as `Authorization: Bearer`, so watchers stay unmodified and the
//   token still applies.
// - No web page. A request carrying an Origin is refused unless the origin is
//   a browser extension's.

/** ActivityWatch's port, where aw-watcher-web and awatcher look by default. */
export const DEFAULT_LOCAL_API_PORT = 5600;

/** Largest request body accepted, in bytes. Reports are a few hundred bytes. */
export const MAX_LOCAL_BODY_BYTES = 64 * 1024;

export interface LocalRequest {
  method: string;
  /** Path and query, as the request line gave them. */
  url: string;
  /** Lowercased header names. */
  headers: Record<string, string | undefined>;
  /** The body as text, or '' for none. */
  body: string;
}

export interface LocalResponse {
  status: number;
  headers: Record<string, string>;
  /** Serialized as JSON when not undefined. */
  body?: unknown;
}

export interface LocalApiOptions {
  feed: LocalFeed;
  token: string;
  /** The port the listener is on, for the Host check. */
  port: number;
  /** Answer the ActivityWatch-compatible subset under /api/0. Default true. */
  activityWatch?: boolean;
  /** What /api/0/info reports about this agent. */
  info: { hostname: string; version: string; deviceId?: string };
  now?: () => number;
}

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);
const EXTENSION_ORIGIN = /^(chrome-extension|moz-extension|safari-web-extension):\/\/[^/]+$/i;

/** True when two strings are equal, in time that doesn't depend on where they differ. */
function sameSecret(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

const json = (status: number, body?: unknown, headers: Record<string, string> = {}) => ({
  status,
  headers: body === undefined ? headers : { 'content-type': 'application/json', ...headers },
  body,
});

/** A bucket some watcher created; held in memory, rebuilt by the next heartbeat after a restart. */
interface Bucket {
  id: string;
  type: string;
  client: string;
  hostname: string;
  created: string;
}

/** What a heartbeat's data says its bucket is, for one that arrives before its bucket. */
function inferType(data: Record<string, unknown>): string {
  if (typeof data.status === 'string') return 'afkstatus';
  if (typeof data.url === 'string') return 'web.tab.current';
  if (typeof data.app === 'string') return 'currentwindow';
  return 'unknown';
}

/** The report an ActivityWatch event stands for, or null for a type the agent doesn't use. */
function reportFromEvent(
  type: string,
  bucketId: string,
  data: Record<string, unknown>,
  start: number,
): LocalReport | null {
  switch (type) {
    case 'currentwindow':
      return typeof data.app === 'string' && data.app !== ''
        ? {
            kind: 'window',
            app: data.app,
            title: typeof data.title === 'string' ? data.title : null,
          }
        : null;
    case 'afkstatus':
      return data.status === 'afk' || data.status === 'not-afk'
        ? { kind: 'afk', afk: data.status === 'afk', since: start }
        : null;
    case 'web.tab.current': {
      // aw-watcher-web names its bucket `aw-watcher-web-<browser>[_<host>]`.
      const browser = /^aw-watcher-web-([a-z]+)/i.exec(bucketId)?.[1] ?? null;
      return {
        kind: 'browser',
        url: typeof data.url === 'string' ? data.url : null,
        title: typeof data.title === 'string' ? data.title : null,
        incognito: data.incognito === true,
        browser,
      };
    }
    default:
      return null;
  }
}

export function createLocalApi(options: LocalApiOptions) {
  const now = options.now ?? Date.now;
  const buckets = new Map<string, Bucket>();
  const activityWatch = options.activityWatch !== false;

  const parseBody = (request: LocalRequest): { ok: true; value: unknown } | { ok: false } => {
    if (request.body.trim() === '') return { ok: true, value: undefined };
    try {
      return { ok: true, value: JSON.parse(request.body) };
    } catch {
      return { ok: false };
    }
  };

  /** /v1: the agent's own shape — one report, a list, or {events: [...]}. */
  const handleV1 = (request: LocalRequest, path: string): LocalResponse => {
    if (path === '/v1/status' && request.method === 'GET') {
      return json(200, { sources: options.feed.sources() });
    }
    if (path === '/v1/events' && request.method === 'POST') {
      const body = parseBody(request);
      if (!body.ok) return json(400, { error: 'body is not JSON' });
      const raw = body.value as unknown;
      const list = Array.isArray(raw)
        ? raw
        : raw && typeof raw === 'object' && Array.isArray((raw as { events?: unknown }).events)
          ? (raw as { events: unknown[] }).events
          : [raw];
      // Checked as a whole before any is held: half a batch applied is
      // harder to reason about than none.
      const parsed: { report: LocalReport; source?: string; at?: number; ttlSeconds?: number }[] =
        [];
      for (const [index, item] of list.entries()) {
        const report = parseReport(item);
        if (typeof report === 'string') return json(400, { error: `event ${index}: ${report}` });
        const extra = item as { source?: unknown; at?: unknown; ttlSeconds?: unknown };
        const at = extra.at === undefined ? undefined : Date.parse(String(extra.at));
        if (at !== undefined && Number.isNaN(at)) {
          return json(400, { error: `event ${index}: at must be an ISO timestamp` });
        }
        parsed.push({
          report,
          source:
            typeof extra.source === 'string' && extra.source !== '' ? extra.source : undefined,
          at,
          ttlSeconds: typeof extra.ttlSeconds === 'number' ? extra.ttlSeconds : undefined,
        });
      }
      for (const { report, ...rest } of parsed) options.feed.report(report, rest);
      return json(200, { accepted: parsed.length });
    }
    return json(404, { error: 'not found' });
  };

  /** /api/0: the subset of ActivityWatch's REST API its watchers call. */
  const handleActivityWatch = (
    request: LocalRequest,
    path: string,
    query: URLSearchParams,
  ): LocalResponse => {
    // Split before decoding: a bucket id may hold an encoded slash.
    const segments = path
      .slice('/api/0/'.length)
      .split('/')
      .map((segment) => {
        try {
          return decodeURIComponent(segment);
        } catch {
          return segment;
        }
      });
    const [root, id, sub] = segments;
    const method = request.method;

    if (root === 'info' && method === 'GET') {
      return json(200, {
        hostname: options.info.hostname,
        version: `eunomia-agent ${options.info.version}`,
        testing: false,
        profile: 'default',
        device_id: options.info.deviceId ?? options.info.hostname,
      });
    }
    if (root === 'settings') return json(200, method === 'GET' ? {} : undefined);
    if (root !== 'buckets') return json(404, { message: 'not found' });

    if (!id) {
      if (method !== 'GET') return json(405, { message: 'method not allowed' });
      return json(200, Object.fromEntries([...buckets].map(([key, bucket]) => [key, bucket])));
    }

    if (sub === undefined) {
      if (method === 'GET') {
        const bucket = buckets.get(id);
        return bucket ? json(200, bucket) : json(404, { message: `no bucket ${id}` });
      }
      if (method === 'DELETE') {
        buckets.delete(id);
        return json(200, {});
      }
      if (method === 'POST') {
        // 304 for one that exists is what aw-client-js's ensureBucket expects.
        if (buckets.has(id)) return { status: 304, headers: {} };
        const body = parseBody(request);
        const meta = (
          body.ok && body.value && typeof body.value === 'object' ? body.value : {}
        ) as Record<string, unknown>;
        buckets.set(id, {
          id,
          type: typeof meta.type === 'string' ? meta.type : 'unknown',
          client: typeof meta.client === 'string' ? meta.client : 'unknown',
          hostname: typeof meta.hostname === 'string' ? meta.hostname : options.info.hostname,
          created: new Date(now()).toISOString(),
        });
        return json(200, {});
      }
      return json(405, { message: 'method not allowed' });
    }

    if (sub === 'heartbeat' && method === 'POST') {
      const body = parseBody(request);
      const event = (body.ok ? body.value : null) as {
        timestamp?: unknown;
        duration?: unknown;
        data?: unknown;
      } | null;
      if (!event || typeof event !== 'object' || !event.data || typeof event.data !== 'object') {
        return json(400, { message: 'a heartbeat is {timestamp, duration, data}' });
      }
      const data = event.data as Record<string, unknown>;
      // A watcher that outlived an agent restart heartbeats into a bucket this
      // process never saw created; the data says what it is.
      let bucket = buckets.get(id);
      if (!bucket) {
        bucket = {
          id,
          type: inferType(data),
          client: 'unknown',
          hostname: options.info.hostname,
          created: new Date(now()).toISOString(),
        };
        buckets.set(id, bucket);
      }
      const parsedStart = Date.parse(String(event.timestamp));
      const start = Number.isNaN(parsedStart) ? now() : parsedStart;
      const duration =
        typeof event.duration === 'number' && event.duration > 0 ? event.duration : 0;
      const pulsetime = Number(query.get('pulsetime'));
      const report = reportFromEvent(bucket.type, id, data, start);
      if (report) {
        // Fresh until the event's end plus the pulsetime the watcher promised
        // to beat within — never less than a few ticks, so one late packet
        // doesn't flicker the foreground.
        options.feed.report(report, {
          source: id,
          at: start + duration * 1000,
          ttlSeconds: Math.max(Number.isFinite(pulsetime) ? pulsetime : 0, 5),
        });
      }
      return json(200, { timestamp: new Date(start).toISOString(), duration, data });
    }

    // Watchers that also insert finished events, or read their own back. The
    // agent reports the present only, so these are acknowledged and dropped.
    if (sub === 'events') {
      if (method === 'POST') return json(200, {});
      if (method === 'GET') return json(200, segments[3] === 'count' ? 0 : []);
    }
    return json(404, { message: 'not found' });
  };

  return {
    handle(request: LocalRequest): LocalResponse {
      const host = (request.headers.host ?? '').toLowerCase();
      const hostName = host.replace(/:\d+$/, '');
      const hostPort = /:(\d+)$/.exec(host)?.[1];
      if (
        !LOOPBACK_HOSTS.has(hostName) ||
        (hostPort !== undefined && Number(hostPort) !== options.port)
      ) {
        return json(403, { error: 'loopback only' });
      }

      const origin = request.headers.origin;
      if (origin !== undefined && !EXTENSION_ORIGIN.test(origin)) {
        return json(403, { error: 'web pages may not call the agent' });
      }
      const cors: Record<string, string> =
        origin === undefined
          ? {}
          : {
              'access-control-allow-origin': origin,
              'access-control-allow-headers': 'authorization, content-type',
              'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
              vary: 'origin',
            };
      const withCors = (response: LocalResponse): LocalResponse => ({
        ...response,
        headers: { ...response.headers, ...cors },
      });

      // A preflight carries no credentials by design; it only learns the
      // route accepts the headers, and the real request is still checked.
      if (request.method === 'OPTIONS') return withCors({ status: 204, headers: {} });

      const authorization = request.headers.authorization ?? '';
      const presented = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
      if (!presented || !sameSecret(presented, options.token)) {
        return withCors(json(401, { error: 'missing or wrong token' }));
      }

      const parsed = new URL(request.url, 'http://127.0.0.1');
      const path = parsed.pathname.replace(/\/+$/, '') || '/';
      if (path === '/v1' || path.startsWith('/v1/')) return withCors(handleV1(request, path));
      if (activityWatch && (path === '/api/0' || path.startsWith('/api/0/'))) {
        // `/api/0/buckets/` (the list) arrives here as `/api/0/buckets`.
        return withCors(handleActivityWatch(request, path, parsed.searchParams));
      }
      return withCors(json(404, { error: 'not found' }));
    },
  };
}
