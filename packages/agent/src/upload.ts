import { type AgentConfig, createDeviceSdk, GraphQLRequestError } from './api.ts';
import type { Outbox } from './outbox.ts';
import { FLUSH_BATCH_SIZE, type Ping } from './ping.ts';

/**
 * Error codes that mean "this exact batch will never be accepted" — it is
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

/**
 * Decides the fate of a batch from whatever the upload threw.
 *
 * A GraphQL failure is HTTP 200 with the error in the body, so "the request
 * succeeded" proves nothing: a revoked device key answers 200, and treating
 * that as success discarded the pings permanently while the agent kept
 * reporting that it was uploading.
 *
 * Nothing about the *count* the server returns is a failure signal. recordPings
 * answers 0 for a batch of idle pings, which is an hour away from the keyboard
 * — reading that as failure wedged the outbox: the batch was kept, re-sent
 * forever, and every later ping queued behind it.
 */
export function classifyFailure(error: unknown): UploadResult {
  const message = error instanceof Error ? error.message : String(error);
  const code = error instanceof GraphQLRequestError ? error.code : null;
  if (code !== null && PERMANENT_CODES.has(code)) {
    // Retrying can't fix this batch, and keeping it would wedge everything
    // queued behind it.
    console.error('dropping rejected pings:', message);
    return { accepted: true, error: null };
  }
  console.error('upload rejected:', message);
  return { accepted: false, error: message };
}

/**
 * Uploads a batch as one recordPings call.
 *
 * The server folds the whole batch inside one transaction holding the device's
 * fold lock, so it lands whole or not at all — which is why a batch kept after
 * a timeout can be re-sent without double-counting the pings that did land.
 * The device is inferred server-side from the API key.
 */
export async function uploadBatch(config: AgentConfig, batch: Ping[]): Promise<UploadResult> {
  try {
    await createDeviceSdk(config).RecordPings({ pings: batch });
    return { accepted: true, error: null };
  } catch (error) {
    return classifyFailure(error);
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
