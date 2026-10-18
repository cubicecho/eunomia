import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { and, count, eq, gte, isNotNull, isNull, sql, sum } from 'drizzle-orm';
import type { Db } from './db/client.ts';
import { activities, categories, devices, summaries, user } from './db/schema.ts';
import { VERSION } from './health.ts';

// GET /metrics, in Prometheus' text format, for Grafana and friends.
//
// Off unless METRICS_TOKEN is set, and the token is then required as a Bearer
// header: a scrape endpoint is one more door into a server that holds people's
// screen time, and most installs will never want it.
//
// What it says is aggregate by default — how many pings arrive and how late,
// how many devices are alive, how much is waiting on a rebuild — and never
// which device or whose. METRICS_PER_USER=true adds each user's seconds per
// category, labelled by email, for people who want their own time on a
// Grafana board.
//
// The counters live in this process and start at zero on boot, which is what
// Prometheus expects of a counter; everything read from the database is
// computed at scrape time.

/** Where an ingested ping went (see activity/ingest.ts). */
export type PingOutcome = 'folded' | 'backfill' | 'before_log' | 'duplicate' | 'erased';

const PING_OUTCOMES: PingOutcome[] = ['folded', 'backfill', 'before_log', 'duplicate', 'erased'];

/** Upload delay buckets, in seconds: live uploads land in the first few; a device back from a week offline, the last. */
const DELAY_BUCKETS = [10, 30, 60, 300, 900, 3600, 6 * 3600, 24 * 3600, 7 * 24 * 3600];

/** "Alive" windows for the device liveness gauge. */
const SEEN_WINDOWS: [label: string, ms: number][] = [
  ['5m', 5 * 60_000],
  ['1h', 3600_000],
  ['24h', 24 * 3600_000],
];

const startedAt = Date.now();

const counters = {
  pings: new Map<PingOutcome, number>(PING_OUTCOMES.map((outcome) => [outcome, 0])),
  batches: 0,
  delay: { buckets: DELAY_BUCKETS.map(() => 0), count: 0, sum: 0 },
};

/** Counts what an ingestion did with each ping of one batch. */
export function recordIngest(outcomes: PingOutcome[]): void {
  counters.batches += 1;
  for (const outcome of outcomes) {
    counters.pings.set(outcome, (counters.pings.get(outcome) ?? 0) + 1);
  }
}

/**
 * How long an agent's pings sat before reaching the server: receipt time minus
 * capture time. The server can't see an agent's outbox, but this is its
 * shadow — a device draining a backlog shows up here as hours of delay.
 */
export function recordUploadDelay(capturedAts: Date[], receivedAt = new Date()): void {
  const { delay } = counters;
  for (const capturedAt of capturedAts) {
    const seconds = Math.max(0, (receivedAt.getTime() - capturedAt.getTime()) / 1000);
    delay.count += 1;
    delay.sum += seconds;
    for (const [i, bound] of DELAY_BUCKETS.entries()) if (seconds <= bound) delay.buckets[i]! += 1;
  }
}

/** For tests: back to a fresh process. */
export function resetMetrics(): void {
  for (const outcome of PING_OUTCOMES) counters.pings.set(outcome, 0);
  counters.batches = 0;
  counters.delay = { buckets: DELAY_BUCKETS.map(() => 0), count: 0, sum: 0 };
}

export interface MetricsOptions {
  /** METRICS_PER_USER: add per-user category seconds. */
  perUser?: boolean;
  now?: Date;
}

type Labels = Record<string, string>;

class Exposition {
  private lines: string[] = [];

  metric(name: string, type: 'counter' | 'gauge' | 'histogram', help: string): this {
    this.lines.push(`# HELP ${name} ${help}`, `# TYPE ${name} ${type}`);
    return this;
  }

  sample(name: string, value: number, labels: Labels = {}): this {
    const pairs = Object.entries(labels).map(([key, val]) => `${key}="${escapeLabel(val)}"`);
    const suffix = pairs.length > 0 ? `{${pairs.join(',')}}` : '';
    this.lines.push(`${name}${suffix} ${formatValue(value)}`);
    return this;
  }

  toString(): string {
    return `${this.lines.join('\n')}\n`;
  }
}

/** Label values escape backslash, double quote and newline; nothing else. */
function escapeLabel(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

function formatValue(value: number): string {
  if (Number.isNaN(value)) return 'NaN';
  if (value === Number.POSITIVE_INFINITY) return '+Inf';
  if (value === Number.NEGATIVE_INFINITY) return '-Inf';
  return String(value);
}

/** The whole scrape, as Prometheus text. A database that won't answer is eunomia_up 0, not a 500. */
export async function renderMetrics(db: Db, options: MetricsOptions = {}): Promise<string> {
  const now = options.now ?? new Date();
  const out = new Exposition();

  out
    .metric('eunomia_build_info', 'gauge', 'This server build; the value is always 1.')
    .sample('eunomia_build_info', 1, { version: VERSION })
    .metric(
      'process_start_time_seconds',
      'gauge',
      'When this server process started, in Unix seconds.',
    )
    .sample('process_start_time_seconds', Math.floor(startedAt / 1000));

  out.metric(
    'eunomia_pings_ingested_total',
    'counter',
    'Pings ingested since start, by what happened to them: folded live, logged for a backfill replay, ' +
      'logged before the complete part of the ping log, skipped as a duplicate of a retry, ' +
      'or dropped inside a deleted range.',
  );
  for (const [outcome, value] of counters.pings) {
    out.sample('eunomia_pings_ingested_total', value, { outcome });
  }
  out
    .metric(
      'eunomia_ping_batches_total',
      'counter',
      'Ping batches ingested since start (uploads and imports).',
    )
    .sample('eunomia_ping_batches_total', counters.batches);

  const { delay } = counters;
  out.metric(
    'eunomia_upload_delay_seconds',
    'histogram',
    "Time between an agent capturing a ping and the server receiving it; a growing tail is an agent's outbox draining.",
  );
  for (const [i, bound] of DELAY_BUCKETS.entries()) {
    out.sample('eunomia_upload_delay_seconds_bucket', delay.buckets[i]!, { le: String(bound) });
  }
  out
    .sample('eunomia_upload_delay_seconds_bucket', delay.count, { le: '+Inf' })
    .sample('eunomia_upload_delay_seconds_sum', delay.sum)
    .sample('eunomia_upload_delay_seconds_count', delay.count);

  let database: Exposition | null = null;
  try {
    database = await databaseMetrics(db, now, options.perUser ?? false);
  } catch (error) {
    console.warn(
      '[metrics] database metrics failed:',
      error instanceof Error ? error.message : error,
    );
  }
  out
    .metric('eunomia_up', 'gauge', 'Whether the database answered this scrape (1) or not (0).')
    .sample('eunomia_up', database ? 1 : 0);
  return database ? out.toString() + database.toString() : out.toString();
}

async function databaseMetrics(db: Db, now: Date, perUser: boolean): Promise<Exposition> {
  const out = new Exposition();

  const [users] = await db.select({ n: count() }).from(user);
  out
    .metric('eunomia_users', 'gauge', 'Accounts on this server.')
    .sample('eunomia_users', users?.n ?? 0);

  const byPlatform = await db
    .select({ platform: devices.platform, n: count() })
    .from(devices)
    .groupBy(devices.platform);
  out.metric('eunomia_devices', 'gauge', 'Registered devices, by platform.');
  for (const platform of ['windows', 'macos', 'linux', 'android'] as const) {
    const row = byPlatform.find((r) => r.platform === platform);
    out.sample('eunomia_devices', row?.n ?? 0, { platform });
  }

  out.metric('eunomia_devices_seen', 'gauge', 'Devices that uploaded within the window.');
  for (const [within, ms] of SEEN_WINDOWS) {
    const [row] = await db
      .select({ n: count() })
      .from(devices)
      .where(gte(devices.lastSeenAt, new Date(now.getTime() - ms)));
    out.sample('eunomia_devices_seen', row?.n ?? 0, { within });
  }

  const [never] = await db.select({ n: count() }).from(devices).where(isNull(devices.lastSeenAt));
  out
    .metric('eunomia_devices_never_seen', 'gauge', 'Devices registered that have never uploaded.')
    .sample('eunomia_devices_never_seen', never?.n ?? 0);

  const [replay] = await db
    .select({ n: count() })
    .from(devices)
    .where(isNotNull(devices.replayFrom));
  out
    .metric(
      'eunomia_devices_replay_pending',
      'gauge',
      'Devices waiting on a rebuild after late pings; stuck above zero means the replay job is failing.',
    )
    .sample('eunomia_devices_replay_pending', replay?.n ?? 0);

  const [open] = await db
    .select({ n: count() })
    .from(activities)
    .where(isNull(activities.closedAt));
  const [unrolled] = await db
    .select({ n: count() })
    .from(activities)
    .where(and(isNotNull(activities.closedAt), eq(activities.rolledUp, false)));
  out
    .metric('eunomia_activities_open', 'gauge', 'Activities still accruing.')
    .sample('eunomia_activities_open', open?.n ?? 0)
    .metric(
      'eunomia_activities_unrolled',
      'gauge',
      'Closed activities not yet folded into summaries; the rollup job drains these.',
    )
    .sample('eunomia_activities_unrolled', unrolled?.n ?? 0);

  if (perUser) await categorySeconds(db, out);
  return out;
}

/**
 * Each user's seconds per category, all time: the rolled-up summaries plus the
 * activities not yet rolled into them — the same split the dashboard merges.
 * A gauge, not a counter: deleting time or recategorizing it moves it down.
 */
async function categorySeconds(db: Db, out: Exposition): Promise<void> {
  const rolled = db
    .select({
      userId: devices.userId,
      categoryId: summaries.categoryId,
      seconds: summaries.seconds,
    })
    .from(summaries)
    .innerJoin(devices, eq(devices.id, summaries.deviceId));
  const live = db
    .select({
      userId: devices.userId,
      categoryId: activities.categoryId,
      seconds: activities.activeSeconds,
    })
    .from(activities)
    .innerJoin(devices, eq(devices.id, activities.deviceId))
    .where(eq(activities.rolledUp, false));
  const time = rolled.unionAll(live).as('time');

  const rows = await db
    .select({
      email: user.email,
      category: categories.name,
      seconds: sum(time.seconds).mapWith(Number),
    })
    .from(time)
    .innerJoin(user, eq(user.id, time.userId))
    .leftJoin(categories, eq(categories.id, time.categoryId))
    .groupBy(user.email, categories.id, categories.name)
    .orderBy(user.email, sql`${categories.name} nulls last`);

  out.metric(
    'eunomia_category_seconds',
    'gauge',
    'Active seconds per user and category, all time (METRICS_PER_USER). Uncategorized time has category="".',
  );
  for (const row of rows) {
    out.sample('eunomia_category_seconds', row.seconds ?? 0, {
      user: row.email,
      category: row.category ?? '',
    });
  }
}

/** METRICS_TOKEN, or null when the endpoint is off. */
export function metricsToken(): string | null {
  return process.env.METRICS_TOKEN?.trim() || null;
}

function bearerMatches(req: IncomingMessage, token: string): boolean {
  const header = req.headers.authorization ?? '';
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match) return false;
  const given = Buffer.from(match[1]!.trim());
  const expected = Buffer.from(token);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** The /metrics handler. Off (404) without a token, so its existence isn't advertised. */
export function createMetricsHandler(db: Db, token: string | null, options: MetricsOptions = {}) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (!token) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('Not found\n');
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { allow: 'GET, HEAD' });
      res.end();
      return;
    }
    if (!bearerMatches(req, token)) {
      res.writeHead(401, { 'www-authenticate': 'Bearer realm="metrics"' });
      res.end();
      return;
    }
    const body = await renderMetrics(db, options);
    res.writeHead(200, { 'content-type': 'text/plain; version=0.0.4; charset=utf-8' });
    res.end(req.method === 'HEAD' ? undefined : body);
  };
}
