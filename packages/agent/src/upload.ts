import type { AgentConfig } from './api.ts';
import type { Outbox } from './outbox.ts';
import { FLUSH_BATCH_SIZE, type Ping } from './ping.ts';

/**
 * Uploads a batch as one request of aliased recordPing calls — GraphQL runs
 * root mutation fields serially, which the server's fold logic relies on. The
 * device is inferred server-side from the API key. Returns true if the server
 * processed the batch (even with per-ping errors: those pings are dropped
 * rather than retried forever); false on network/auth failure (retry later).
 */
export async function uploadBatch(config: AgentConfig, batch: Ping[]): Promise<boolean> {
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
      return false;
    }
    const body = (await response.json()) as { data?: unknown; errors?: { message: string }[] };
    if (body.errors?.length) console.error('upload partial errors', body.errors);
    // data present (even partially null) means the server ran the mutations.
    return body.data !== undefined && body.data !== null;
  } catch (error) {
    console.error('upload failed', error);
    return false;
  }
}

/**
 * Drains the outbox in batches, guarding against overlapping runs (an
 * interval tick can fire while a slow flush is still in flight). Stops at the
 * first failed batch — offline, retry on the next tick.
 */
export interface Uploader {
  flush(): Promise<void>;
}

export function createUploader(config: AgentConfig, outbox: Outbox): Uploader {
  let flushing = false;
  return {
    async flush(): Promise<void> {
      if (flushing) return;
      flushing = true;
      try {
        while (outbox.size > 0) {
          const batch = outbox.peek(FLUSH_BATCH_SIZE);
          if (!(await uploadBatch(config, batch))) return; // offline — retry next tick
          outbox.drop(batch.length);
        }
      } finally {
        flushing = false;
      }
    },
  };
}
