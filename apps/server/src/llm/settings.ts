import { type Endpoint, NO_KEY, normalizeBaseUrl, resolveApiKey } from '@cubicecho/agent-core';
import type { Db } from '../db/client.ts';
import { llmSettings } from '../db/schema.ts';

// Which language model this instance asks for rule suggestions and summaries
// (issue #41). eunomia never runs a model itself: it calls an OpenAI-compatible
// endpoint someone pointed it at — a local Ollama, LM Studio, vLLM, or a
// hosted API.
//
// Like single sign-on, it is one setting for the whole instance: the
// environment wins (LLM_BASE_URL, LLM_MODEL, LLM_API_KEY), otherwise the
// admin sets it from the dashboard. Not per user, because the server is the
// one making the request — a user who could aim it anywhere could make this
// server fetch from inside its own network.

/** Where the endpoint in use came from. The GraphQL enum `LlmSource` has the same values. */
export type LlmSource = 'ENV' | 'STORED' | 'NONE';

export interface LlmConfig {
  baseUrl: string;
  model: string;
  /** Null when the endpoint takes none, as a local server usually doesn't. */
  apiKey: string | null;
}

/**
 * How long a reply may take. Generous, since a local model on a CPU is slow
 * and the dashboard is waiting on a button press, not a page load.
 */
const TIMEOUT_SECONDS = 180;

function fromEnv(env: NodeJS.ProcessEnv): LlmConfig | null {
  const baseUrl = env.LLM_BASE_URL?.trim();
  const model = env.LLM_MODEL?.trim();
  if (!baseUrl || !model) return null;
  // Written the way a stored one is, so the two compare alike. One the rule
  // refuses is still used as given: the environment is the operator's say.
  return {
    baseUrl: normalizeBaseUrl(baseUrl) ?? baseUrl,
    model,
    apiKey: env.LLM_API_KEY?.trim() || null,
  };
}

/** The environment's endpoint when LLM_BASE_URL and LLM_MODEL are set, otherwise the stored one. */
export async function effectiveLlm(
  db: Db,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ config: LlmConfig | null; source: LlmSource }> {
  const env_ = fromEnv(env);
  if (env_) return { config: env_, source: 'ENV' };
  const [row] = await db.select().from(llmSettings).limit(1);
  if (!row) return { config: null, source: 'NONE' };
  return {
    config: { baseUrl: row.baseUrl, model: row.model, apiKey: row.apiKey },
    source: 'STORED',
  };
}

/**
 * Saves the endpoint, replacing any before it. `apiKey` undefined keeps the
 * stored key; null removes it — so the dashboard can change the model without
 * having the key, which it is never shown.
 */
export async function saveLlm(
  db: Db,
  input: { baseUrl: string; model: string; apiKey?: string | null },
): Promise<void> {
  const values = { baseUrl: input.baseUrl, model: input.model };
  const key = input.apiKey === undefined ? {} : { apiKey: input.apiKey };
  await db
    .insert(llmSettings)
    .values({ ...values, apiKey: input.apiKey ?? null })
    .onConflictDoUpdate({
      target: llmSettings.id,
      set: { ...values, ...key, updatedAt: new Date() },
    });
}

export async function clearLlm(db: Db): Promise<void> {
  await db.delete(llmSettings);
}

/**
 * The key to ask `baseUrl` with when the admin typed none: the stored one, but
 * only where `baseUrl` is the stored endpoint. A key issued for one endpoint
 * has no business being posted to another. "The same endpoint" is
 * agent-core's rule, the one every host compares by.
 */
export function storedKeyFor(baseUrl: string, stored: LlmConfig | null): string | null {
  const key = resolveApiKey(
    { baseUrl },
    stored ? { baseUrl: stored.baseUrl, apiKey: stored.apiKey ?? undefined } : undefined,
    // Not $OPENAI_API_KEY: this server's key is LLM_API_KEY, read above.
    {},
  );
  return key === NO_KEY ? null : key;
}

/** agent-core's endpoint for a config. */
export function endpointFor(config: LlmConfig): Endpoint {
  return {
    baseUrl: config.baseUrl,
    apiKey: config.apiKey ?? '',
    requestTimeoutSeconds: TIMEOUT_SECONDS,
  };
}
