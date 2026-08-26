import type { AgentConfig } from './api.ts';
import type { Outbox } from './outbox.ts';
import { FLUSH_BATCH_SIZE, type Ping } from './ping.ts';

/**
 * Error codes that mean "this exact ping will never be accepted" — the batch is
 * dropped rather than retried forever. Everything else (auth, rate limits,
 * server faults, anything unrecognized) is treated as temporary: an outbox that
 * grows is recoverable, a dropped ping is not.
 */
const PERMANENT_CODES = new Set(['BAD_USER_INPUT']);

export interface UploadResult {
  /** True when the batch may be dropped — recorded, or unfixably rejected. */
  accepted: boolean;
  /** Why the batch was kept. Null when accepted; shown in the agent's UI. */
  error: string | null;
}

interface GraphQLResponse {
  data?: Record<string, unknown> | null;
  errors?: { message: string; extensions?: { code?: string } }[];
}

/**
 * Decides the fate of a batch from one GraphQL response.
 *
 * A GraphQL error is HTTP 200 with nulls in `data`, so "the request succeeded"
 * proves nothing: a revoked device key answers 200 with every ping null, and
 * treating that as success discarded the pings permanently while the agent kept
 * reporting that it was uploading. `errors` is the signal — a resolved field is
 * a real answer even when the answer is null.
 *
 * Null is what recordPing returns for a ping that touched nothing (idle, or no
 * detectable app), which a whole batch can legitimately consist of. Reading
 * that as failure wedged the outbox: the batch was kept, re-sent forever, and
 * every later ping queued behind it while the tray reported "server recorded
 * nothing".
 *
 * Partial success still drops the batch — recordPing folds a ping into a
 * running activity, so re-sending the ones that landed would double-count time.
 */
export function classifyResponse(body: GraphQLResponse): UploadResult {
  const errors = body.errors ?? [];
  const fields = body.data ? Object.values(body.data) : [];
  if (fields.length === 0) {
    return { accepted: false, error: errors[0]?.message ?? 'server recorded nothing' };
  }
  if (errors.length === 0) return { accepted: true, error: null };
  if (fields.some((value) => value !== null)) return { accepted: true, error: null };

  // Nothing landed. Only drop when every failure is one retrying can't fix.
  const permanent = errors.every((e) => PERMANENT_CODES.has(e.extensions?.code ?? ''));
  if (permanent) {
    console.error('dropping rejected pings', errors.map((e) => e.message).join('; '));
    return { accepted: true, error: null };
  }
  return { accepted: false, error: errors[0]?.message ?? 'server recorded nothing' };
}

/**
 * Uploads a batch as one request of aliased recordPing calls — GraphQL runs
 * root mutation fields serially, which the server's fold logic relies on. The
 * device is inferred server-side from the API key.
 */
export async function uploadBatch(config: AgentConfig, batch: Ping[]): Promise<UploadResult> {
  const vars: Record<string, unknown> = {};
  const defs: string[] = [];
  const fields: string[] = [];
  batch.forEach((ping, i) => {
    defs.push(`$c${i}: String!, $a${i}: String, $t${i}: String, $x${i}: String, $i${i}: Int!`);
    fields.push(
      `p${i}: recordPing(capturedAt: $c${i}, app: $a${i}, title: $t${i}, context: $x${i}, idleSeconds: $i${i}) { id }`,
    );
    vars[`c${i}`] = ping.capturedAt;
    vars[`a${i}`] = ping.app;
    vars[`t${i}`] = ping.title;
    vars[`x${i}`] = ping.context;
    vars[`i${i}`] = ping.idleSeconds;
  });

  try {
    const response = await fetch(new URL('/graphql', config.serverUrl), {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': config.apiKey },
      body: JSON.stringify({
        query: `mutation (${defs.join(', ')}) { ${fields.join(' ')} }`,
        variables: vars,
      }),
    });
    if (!response.ok) {
      console.error(`upload failed: HTTP ${response.status}`);
      return { accepted: false, error: `HTTP ${response.status}` };
    }
    const result = classifyResponse((await response.json()) as GraphQLResponse);
    if (result.error) console.error('upload rejected:', result.error);
    return result;
  } catch (error) {
    console.error('upload failed', error);
    return { accepted: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/** What the tray / status screen shows about uploading. */
export interface UploaderStatus {
  /** Pings still waiting to go up. */
  pending: number;
  /** Why the last flush stopped, or null while uploads are healthy. */
  error: string | null;
  /** Epoch ms of the last batch the server took, or null if none yet. */
  lastUploadAt: number | null;
}

/**
 * Drains the outbox in batches, guarding against overlapping runs (an
 * interval tick can fire while a slow flush is still in flight). Stops at the
 * first batch the server didn't take — offline, signed out, rate limited —
 * leaving it queued for the next tick and reporting why via status().
 */
export interface Uploader {
  flush(): Promise<void>;
  status(): UploaderStatus;
}

export function createUploader(config: AgentConfig, outbox: Outbox): Uploader {
  let flushing = false;
  let error: string | null = null;
  let lastUploadAt: number | null = null;
  return {
    async flush(): Promise<void> {
      if (flushing) return;
      flushing = true;
      try {
        while (outbox.size > 0) {
          const batch = outbox.peek(FLUSH_BATCH_SIZE);
          const result = await uploadBatch(config, batch);
          if (!result.accepted) {
            error = result.error;
            return; // keep the batch — retry on the next tick
          }
          outbox.drop(batch.length);
          lastUploadAt = Date.now();
          error = null;
        }
        error = null;
      } finally {
        flushing = false;
      }
    },
    status: () => ({ pending: outbox.size, error, lastUploadAt }),
  };
}
