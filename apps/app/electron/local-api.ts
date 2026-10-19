import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { join } from 'node:path';
import {
  createLocalApi,
  DEFAULT_LOCAL_API_PORT,
  type LocalApiConfig,
  type LocalApiOptions,
  MAX_LOCAL_BODY_BYTES,
} from '@eunomia/agent';

// The socket half of the local API; what it answers, and to whom, is
// @eunomia/agent's local-api.ts. Loopback only, always: there is no setting
// that binds it anywhere else.

/** Where the token lives: next to config.json, readable by this user alone. */
export const localApiTokenPath = (dataDir: string): string => join(dataDir, 'local-api-token');

/**
 * The token other sources present, made on first use. A file of its own
 * rather than a config.json field: a shell hook can `cat` it, and the setup
 * screen rewriting config.json can never rotate it out from under them.
 */
export function localApiToken(dataDir: string): string {
  const path = localApiTokenPath(dataDir);
  if (existsSync(path)) {
    const existing = readFileSync(path, 'utf8').trim();
    if (existing.length >= 16) return existing;
  }
  const token = randomBytes(24).toString('base64url');
  writeFileSync(path, `${token}\n`, { mode: 0o600 });
  // mode only applies when the file is created; an older, wider file is narrowed.
  chmodSync(path, 0o600);
  return token;
}

export interface LocalApiStatus {
  /** Listening, refused by config, or failed to bind (most likely: ActivityWatch has the port). */
  state: 'listening' | 'disabled' | 'failed';
  port: number;
  error: string | null;
}

/** Starts the listener; never throws — a busy port is reported, not fatal. */
export function startLocalApi(
  config: LocalApiConfig | undefined,
  options: Omit<LocalApiOptions, 'port' | 'activityWatch'>,
  onChange: (status: LocalApiStatus) => void,
): { status(): LocalApiStatus; close(): void } {
  const port = config?.port ?? DEFAULT_LOCAL_API_PORT;
  let status: LocalApiStatus = { state: 'disabled', port, error: null };
  if (config?.enabled === false) return { status: () => status, close: () => {} };

  const api = createLocalApi({ ...options, port, activityWatch: config?.activityWatch });
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_LOCAL_BODY_BYTES) {
        res.writeHead(413, { 'content-type': 'application/json' });
        res.end('{"error":"body too large"}');
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (res.writableEnded) return;
      const headers: Record<string, string | undefined> = {};
      for (const [name, value] of Object.entries(req.headers)) {
        headers[name] = Array.isArray(value) ? value.join(', ') : value;
      }
      const response = api.handle({
        method: req.method ?? 'GET',
        url: req.url ?? '/',
        headers,
        body: Buffer.concat(chunks).toString('utf8'),
      });
      res.writeHead(response.status, response.headers);
      res.end(response.body === undefined ? undefined : JSON.stringify(response.body));
    });
  });

  server.on('error', (error: NodeJS.ErrnoException) => {
    const message =
      error.code === 'EADDRINUSE'
        ? `port ${port} is in use (is ActivityWatch running?)`
        : error.message;
    console.error(`local API not started: ${message}`);
    status = { state: 'failed', port, error: message };
    onChange(status);
  });
  server.listen(port, '127.0.0.1', () => {
    console.log(`local API listening on 127.0.0.1:${port}`);
    status = { state: 'listening', port, error: null };
    onChange(status);
  });

  return { status: () => status, close: () => server.close() };
}
