import type { ImportChunk, ImportSource, ImportTarget } from '@/api';

// Bringing history in. The mirror of the export card's loop: the browser reads
// the file — it's the only side that has it — and hands the server a bounded
// list of records per Mutation.importChunk call, passing the cursor along. The
// server validates every record on its own (apps/server/src/import), so what
// is here is only framing: gunzipping, splitting lines or CSV records, and
// turning ActivityWatch's one big JSON document into events in time order.

/** Records per call — well under the server's MAX_IMPORT_RECORDS. */
const MAX_CHUNK_RECORDS = 2000;

/** Characters per call — half the server's MAX_IMPORT_CHARS. */
const MAX_CHUNK_CHARS = 4 * 1024 * 1024;

/**
 * Time in front of the screen per call, for ActivityWatch: the server emits a
 * ping every 25 s of it and refuses a call that would fold more than 10 000.
 * Twelve hours is about 1 700, with room for an event carried in from the
 * call before.
 */
const MAX_CHUNK_WINDOW_MS = 12 * 60 * 60_000;

/** One record, and — for ActivityWatch window events — how much time it covers. */
export interface ImportRecord {
  text: string;
  ms?: number;
}

/** A file's text, a piece at a time, gunzipped first if it's gzip (whatever it's named). */
export async function* readText(file: Blob): AsyncGenerator<string> {
  const head = new Uint8Array(await file.slice(0, 2).arrayBuffer());
  let bytes: ReadableStream<BufferSource> = file.stream();
  if (head[0] === 0x1f && head[1] === 0x8b) {
    bytes = bytes.pipeThrough(new DecompressionStream('gzip'));
  }
  const reader = bytes.pipeThrough(new TextDecoderStream()).getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return;
    yield value;
  }
}

/** Non-blank lines, without their line endings. */
export async function* lines(pieces: AsyncIterable<string>): AsyncGenerator<string> {
  let rest = '';
  for await (const piece of pieces) {
    const parts = (rest + piece).split('\n');
    rest = parts.pop()!;
    for (const part of parts) if (part.trim()) yield part.replace(/\r$/, '');
  }
  if (rest.trim()) yield rest.replace(/\r$/, '');
}

/** Non-blank CSV records: split at line breaks outside double quotes. */
export async function* csvRecords(pieces: AsyncIterable<string>): AsyncGenerator<string> {
  let record = '';
  let quoted = false;
  for await (const piece of pieces) {
    let from = 0;
    for (let i = 0; i < piece.length; i++) {
      const char = piece[i];
      // An escaped quote ("") toggles twice, which is no toggle at all.
      if (char === '"') quoted = !quoted;
      else if (char === '\n' && !quoted) {
        const done = (record + piece.slice(from, i)).replace(/\r$/, '');
        record = '';
        from = i + 1;
        if (done.trim()) yield done;
      }
    }
    record += piece.slice(from);
  }
  if (record.trim()) yield record.replace(/\r$/, '');
}

/** Everything a stream of text holds, for the formats that are one JSON document. */
export async function wholeText(pieces: AsyncIterable<string>): Promise<string> {
  const parts: string[] = [];
  for await (const piece of pieces) parts.push(piece);
  return parts.join('');
}

/** Records grouped into calls' worth. */
export async function* batches(records: AsyncIterable<ImportRecord>): AsyncGenerator<string[]> {
  let batch: string[] = [];
  let chars = 0;
  let ms = 0;
  for await (const record of records) {
    const full =
      batch.length >= MAX_CHUNK_RECORDS ||
      chars + record.text.length > MAX_CHUNK_CHARS ||
      ms + (record.ms ?? 0) > MAX_CHUNK_WINDOW_MS;
    if (full && batch.length > 0) {
      yield batch;
      batch = [];
      chars = 0;
      ms = 0;
    }
    batch.push(record.text);
    chars += record.text.length;
    ms += record.ms ?? 0;
  }
  if (batch.length > 0) yield batch;
}

async function* asRecords(texts: AsyncIterable<string> | Iterable<string>) {
  for await (const text of texts) yield { text };
}

// --- ActivityWatch ---------------------------------------------------------

export interface AwBucket {
  type?: unknown;
  hostname?: unknown;
  events?: unknown;
}

interface AwEvent {
  timestamp?: unknown;
  duration?: unknown;
  data?: unknown;
}

/** The bucket types an import reads; everything else in an export is left out. */
const AW_TYPES = new Set(['currentwindow', 'afkstatus', 'web.tab.current']);

/** One machine in an ActivityWatch export: what an import into one device reads. */
export interface AwHost {
  hostname: string;
  windowEvents: number;
  afk: boolean;
  web: boolean;
}

/** The buckets of aw-server's export (Settings → Export, or /api/0/export). */
export function parseAwExport(text: string): AwBucket[] {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    throw new Error('Not an ActivityWatch export: the file is not JSON');
  }
  const buckets = (doc as { buckets?: unknown } | null)?.buckets;
  if (typeof buckets !== 'object' || buckets === null) {
    throw new Error('Not an ActivityWatch export: it has no buckets');
  }
  return Object.values(buckets as Record<string, AwBucket>);
}

const hostnameOf = (bucket: AwBucket): string =>
  typeof bucket.hostname === 'string' ? bucket.hostname : 'unknown';

/**
 * Whether `bucket` belongs to `hostname`. aw-watcher-web long reported its
 * buckets as hostname "unknown" — the browser extension can't see the machine's
 * name — so those go with whichever machine is imported.
 */
const onHost = (bucket: AwBucket, hostname: string): boolean =>
  hostnameOf(bucket) === hostname ||
  (bucket.type === 'web.tab.current' && hostnameOf(bucket) === 'unknown');

/** The machines with window buckets, most history first. */
export function awHosts(buckets: AwBucket[]): AwHost[] {
  const names = [...new Set(buckets.filter((b) => b.type === 'currentwindow').map(hostnameOf))];
  return names
    .map((hostname) => {
      const mine = buckets.filter((b) => onHost(b, hostname));
      return {
        hostname,
        windowEvents: mine
          .filter((b) => b.type === 'currentwindow')
          .reduce((n, b) => n + (Array.isArray(b.events) ? b.events.length : 0), 0),
        afk: mine.some((b) => b.type === 'afkstatus'),
        web: mine.some((b) => b.type === 'web.tab.current'),
      };
    })
    .sort((a, b) => b.windowEvents - a.windowEvents);
}

/**
 * One machine's events as import records: the header, then every event across
 * its buckets in time order (aw-server exports newest first, per bucket).
 */
export function awRecords(buckets: AwBucket[], hostname: string): ImportRecord[] {
  const mine = buckets.filter((b) => AW_TYPES.has(b.type as string) && onHost(b, hostname));
  const events = mine.flatMap((bucket) =>
    (Array.isArray(bucket.events) ? (bucket.events as AwEvent[]) : []).map((event) => {
      const start = typeof event.timestamp === 'string' ? Date.parse(event.timestamp) : Number.NaN;
      return {
        // Unreadable times first: the server skips them, and they can't then
        // hold back the time order of the rest.
        start: Number.isNaN(start) ? Number.NEGATIVE_INFINITY : start,
        ms:
          bucket.type === 'currentwindow' && typeof event.duration === 'number'
            ? Math.max(0, event.duration * 1000)
            : 0,
        text: JSON.stringify({ type: bucket.type, ...event }),
      };
    }),
  );
  events.sort((a, b) => a.start - b.start);
  return [
    {
      text: JSON.stringify({
        format: 'activitywatch',
        afk: mine.some((b) => b.type === 'afkstatus'),
      }),
    },
    ...events.map(({ text, ms }) => ({ text, ms })),
  ];
}

// --- RescueTime ------------------------------------------------------------

/**
 * RescueTime's report as CSV records. The API's JSON form
 * ({row_headers, rows}) is turned into the same CSV the export page gives.
 */
export async function* rescueTimeRecords(file: Blob): AsyncGenerator<string> {
  const pieces = readText(file);
  const first = await pieces.next();
  if (first.done) return;
  async function* whole() {
    yield first.value as string;
    yield* pieces;
  }
  if (!/^\uFEFF?\s*\{/.test(first.value)) {
    yield* csvRecords(whole());
    return;
  }
  let report: { row_headers?: unknown; rows?: unknown };
  try {
    report = JSON.parse(await wholeText(whole()));
  } catch {
    throw new Error('Not a RescueTime export: the file is not valid JSON');
  }
  if (!Array.isArray(report.row_headers) || !Array.isArray(report.rows)) {
    throw new Error('Not a RescueTime export: it has no row_headers and rows');
  }
  const csv = (value: unknown) => {
    const text = value == null ? '' : String(value);
    return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  yield report.row_headers.map(csv).join(',');
  for (const row of report.rows) if (Array.isArray(row)) yield row.map(csv).join(',');
}

// --- Driving the calls -----------------------------------------------------

export interface ImportProgress {
  /** Records the server has taken so far, accepted or skipped. */
  records: number;
  pings: number;
  /** A bundle is read twice; the second read is quick. */
  pass: number;
}

export interface ImportResult {
  accepted: number;
  skipped: number;
  pings: number;
  deviceIds: string[];
  warnings: string[];
}

/** The server call, injected so this file stays free of the transport. */
export type SendChunk = (variables: {
  source: ImportSource;
  records: string[];
  cursor: string | null;
  target: ImportTarget | null;
  done: boolean;
}) => Promise<ImportChunk>;

/** Each call reports its warnings as "reason (×n)"; this adds them up across calls. */
export class WarningTally {
  readonly #counts = new Map<string, number>();

  add(warnings: readonly string[]): void {
    for (const warning of warnings) {
      const match = /^(.*?)(?: \(×(\d+)\))?$/s.exec(warning)!;
      const reason = match[1]!;
      this.#counts.set(reason, (this.#counts.get(reason) ?? 0) + Number(match[2] ?? 1));
    }
  }

  list(): string[] {
    return [...this.#counts].map(([reason, n]) => (n === 1 ? reason : `${reason} (×${n})`));
  }
}

/**
 * Sends an import's records, `readPass(n)` giving the whole file for pass n —
 * a bundle asks for it twice (see apps/server/src/import/bundle.ts). The last
 * call of a pass says `done`, which is how the server knows a file wasn't cut
 * short; so each batch is sent only once the one after it has been read.
 */
export async function runImport(
  send: SendChunk,
  source: ImportSource,
  target: ImportTarget | null,
  readPass: (pass: number) => AsyncIterable<ImportRecord>,
  onProgress: (progress: ImportProgress) => void = () => {},
): Promise<ImportResult> {
  const result = { accepted: 0, skipped: 0, pings: 0 };
  const warnings = new WarningTally();
  const deviceIds = new Set<string>();
  let cursor: string | null = null;

  for (let pass = 1; pass <= 2; pass++) {
    const pending = batches(readPass(pass));
    let current = await pending.next();
    for (;;) {
      const next: IteratorResult<string[]> = current.done ? current : await pending.next();
      const done = next.done === true;
      const chunk = await send({
        source,
        records: current.done ? [] : current.value,
        cursor,
        target: cursor === null ? target : null,
        done,
      });
      result.accepted += chunk.accepted;
      result.skipped += chunk.skipped;
      result.pings += chunk.pings;
      warnings.add(chunk.warnings);
      for (const id of chunk.deviceIds) deviceIds.add(id);
      onProgress({ records: result.accepted + result.skipped, pings: result.pings, pass });

      if (chunk.next == null) {
        return { ...result, deviceIds: [...deviceIds], warnings: warnings.list() };
      }
      cursor = chunk.next;
      if (chunk.restart) break;
      if (done) throw new Error('The server expected more of the file than there was');
      current = next;
    }
    await pending.return(undefined);
  }
  throw new Error('The server asked for the file more times than an import reads it');
}

/** What a bundle's second read needs: summaries, activities, and the end record. */
const SECOND_PASS = /^\{\s*"type"\s*:\s*"(summary|activity|end)"/;

export async function* bundleRecords(file: Blob, pass: number): AsyncGenerator<ImportRecord> {
  for await (const line of lines(readText(file))) {
    if (pass === 1 || SECOND_PASS.test(line)) yield { text: line };
  }
}

export const csvImportRecords = (file: Blob) => asRecords(rescueTimeRecords(file));
