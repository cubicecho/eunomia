import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { resetClients } from '@cubicecho/agent-core';
import { eq } from 'drizzle-orm';
import { graphql } from 'graphql';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ingestPings } from '../src/activity/ingest.ts';
import type { RawPing } from '../src/activity/ping-log.ts';
import { categories, categoryRules, type Device, devices, user } from '../src/db/schema.ts';
import type { Context } from '../src/graphql/context.ts';
import { createSchema } from '../src/graphql/schema.ts';
import { exactPattern } from '../src/llm/assist.ts';
import { stubAuthGateway } from './helpers/stub-auth.ts';
import { createMigratedTestDb } from './helpers/test-db.ts';

// Bring-your-own model (issue #41). No model runs here: a tiny HTTP server
// stands in for the OpenAI-compatible endpoint, records what it was sent, and
// answers with whatever the test sets. That is the point of most of these —
// what leaves the server, and what is done with the answer.

const T0 = new Date('2026-08-16T12:00:00.000Z');
const ping = (seconds: number, app: string, extra: Partial<RawPing> = {}): RawPing => ({
  capturedAt: new Date(T0.getTime() + seconds * 1000),
  app,
  title: null,
  context: null,
  idleSeconds: 0,
  ...extra,
});
const RANGE = 'from: "2026-08-10", to: "2026-08-20"';

/** What the fake endpoint received, and what it will say next. */
const endpoint = {
  requests: [] as { path: string; auth: string | undefined; body: Record<string, unknown> }[],
  reply: '' as string,
  status: 200,
  url: '',
};

let server: Server;

const readBody = (req: IncomingMessage) =>
  new Promise<string>((resolve) => {
    let text = '';
    req.on('data', (chunk) => {
      text += chunk;
    });
    req.on('end', () => resolve(text));
  });

beforeAll(async () => {
  server = createServer(async (req, res) => {
    const text = await readBody(req);
    if (req.method !== 'POST' || !req.url?.endsWith('/chat/completions')) {
      res.writeHead(404).end();
      return;
    }
    endpoint.requests.push({
      path: req.url,
      auth: req.headers.authorization,
      body: JSON.parse(text) as Record<string, unknown>,
    });
    if (endpoint.status !== 200) {
      res.writeHead(endpoint.status, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'model "nope" not found' } }));
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        id: 'chatcmpl-test',
        object: 'chat.completion',
        created: 0,
        model: 'test-model',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: endpoint.reply },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  endpoint.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

describe('bring-your-own language model', () => {
  let db: Awaited<ReturnType<typeof createMigratedTestDb>>;

  const as = (userId: string | undefined, keyId?: string): Context =>
    ({ db, userId, keyId, deviceId: undefined, headers: new Headers() }) as Context;

  const run = (source: string, ctx: Context = as('admin')) =>
    graphql({ schema: createSchema(db as never, stubAuthGateway()), source, contextValue: ctx });

  const data = async <T>(source: string, ctx?: Context): Promise<T> => {
    const result = await run(source, ctx);
    expect(result.errors).toBeUndefined();
    return result.data as T;
  };

  const code = async (source: string, ctx?: Context) =>
    (await run(source, ctx)).errors?.[0]?.extensions?.code;

  const configure = (apiKey = 'sk-test-secret') =>
    data(
      `mutation { setLlmSettings(baseUrl: "${endpoint.url}", model: "test-model", apiKey: "${apiKey}") { source } }`,
    );

  const lastUserMessage = () => {
    const messages = endpoint.requests.at(-1)?.body.messages as { role: string; content: string }[];
    return messages.find((message) => message.role === 'user')?.content ?? '';
  };

  beforeEach(async () => {
    endpoint.requests = [];
    endpoint.reply = '';
    endpoint.status = 200;
    resetClients();
    db = await createMigratedTestDb();
    await db.insert(user).values([
      { id: 'admin', name: 'a', email: 'a@example.com', isAdmin: true },
      { id: 'member', name: 'm', email: 'm@example.com' },
    ]);
    await db
      .insert(devices)
      .values({ id: 'device-1', userId: 'admin', name: 'laptop', platform: 'linux' });
    await db
      .insert(categories)
      .values({ id: 'cat-work', userId: 'admin', name: 'Work', kind: 'work' });
    const [device] = await db.select().from(devices).where(eq(devices.id, 'device-1'));
    await ingestPings(db as never, device as Device, [
      ping(0, 'firefox', { context: 'shop.example', title: 'Cart (3) — a private title' }),
      ping(10, 'firefox', { context: 'shop.example', title: 'Cart (3) — a private title' }),
      ping(20, 'firefox', { context: 'shop.example', title: 'Cart (3) — a private title' }),
      ping(30, 'slack', { title: 'general — team' }),
      ping(40, 'slack', { title: 'general — team' }),
      ping(50, 'terminal'),
    ]);
  });

  afterEach(() => {
    delete process.env.LLM_BASE_URL;
    delete process.env.LLM_MODEL;
    delete process.env.LLM_API_KEY;
  });

  it('is off until a model is set up', async () => {
    const { llmSettings } = await data<{ llmSettings: Record<string, unknown> }>(
      '{ llmSettings { source baseUrl model hasApiKey canEdit } }',
    );
    expect(llmSettings).toEqual({
      source: 'NONE',
      baseUrl: null,
      model: null,
      hasApiKey: false,
      canEdit: true,
    });
    expect(await code(`{ suggestRules(${RANGE}) { app } }`)).toBe('FAILED_PRECONDITION');
    expect(await code('{ draftStandup(day: "2026-08-16") { text } }')).toBe('FAILED_PRECONDITION');
    expect(endpoint.requests).toEqual([]);
  });

  it('lets only the admin, signed in, point it at an endpoint, and never shows the key', async () => {
    const set = `mutation { setLlmSettings(baseUrl: "${endpoint.url}", model: "m", apiKey: "k") { source } }`;
    expect(await code(set, as('member'))).toBe('FORBIDDEN');
    // A key is refused before the resolver: the dashboard's setting, not an integration's.
    expect(await code(set, as('admin', 'key-1'))).toBe('UNAUTHENTICATED');
    expect(
      (
        await data<{ llmSettings: { canEdit: boolean } }>(
          '{ llmSettings { canEdit } }',
          as('member'),
        )
      ).llmSettings.canEdit,
    ).toBe(false);

    await configure();
    const read = await run('{ llmSettings { source baseUrl model hasApiKey canEdit } }');
    expect(read.data?.llmSettings).toEqual({
      source: 'STORED',
      baseUrl: endpoint.url,
      model: 'test-model',
      hasApiKey: true,
      canEdit: true,
    });
    expect(JSON.stringify(read)).not.toContain('sk-test-secret');

    // Changing the model without the key keeps the key; null removes it.
    await data(
      `mutation { setLlmSettings(baseUrl: "${endpoint.url}/", model: "other") { model hasApiKey baseUrl } }`,
    );
    const kept = await data<{ llmSettings: { hasApiKey: boolean; baseUrl: string } }>(
      '{ llmSettings { hasApiKey baseUrl } }',
    );
    expect(kept.llmSettings).toEqual({ hasApiKey: true, baseUrl: endpoint.url });
    await data(
      `mutation { setLlmSettings(baseUrl: "${endpoint.url}", model: "other", apiKey: null) { source } }`,
    );
    expect(
      (await data<{ llmSettings: { hasApiKey: boolean } }>('{ llmSettings { hasApiKey } }'))
        .llmSettings.hasApiKey,
    ).toBe(false);

    for (const bad of ['ftp://x/v1', 'http://user:pass@host/v1', 'not a url', 'http://h/v1?x=1']) {
      expect(
        await code(`mutation { setLlmSettings(baseUrl: "${bad}", model: "m") { source } }`),
      ).toBe('BAD_USER_INPUT');
    }

    await data('mutation { clearLlmSettings { source } }');
    expect(
      (await data<{ llmSettings: { source: string } }>('{ llmSettings { source } }')).llmSettings
        .source,
    ).toBe('NONE');
  });

  it('defers to the environment when LLM_BASE_URL is set', async () => {
    process.env.LLM_BASE_URL = endpoint.url;
    process.env.LLM_MODEL = 'env-model';
    const { llmSettings } = await data<{ llmSettings: Record<string, unknown> }>(
      '{ llmSettings { source model canEdit hasApiKey } }',
    );
    expect(llmSettings).toEqual({
      source: 'ENV',
      model: 'env-model',
      canEdit: false,
      hasApiKey: false,
    });
    expect(
      await code(`mutation { setLlmSettings(baseUrl: "${endpoint.url}", model: "m") { source } }`),
    ).toBe('FORBIDDEN');
  });

  it('turns the model’s picks into exact rules with previews, and creates nothing', async () => {
    await configure();
    endpoint.reply = JSON.stringify({
      suggestions: [
        { entry: 1, scope: 'context', category: 'Shopping', reason: 'A store.' },
        { entry: 2, scope: 'app', category: 'work', reason: 'Team chat.' },
        // Out of range, a repeat of the first, and "context" on an entry with none.
        { entry: 9, scope: 'app', category: 'Work', reason: '' },
        { entry: 1, scope: 'context', category: 'Other', reason: '' },
        { entry: 3, scope: 'context', category: 'Work', reason: 'A shell.' },
      ],
    });

    const { suggestRules } = await data<{ suggestRules: Record<string, unknown>[] }>(`{
      suggestRules(${RANGE}) {
        app context seconds appPattern contextPattern categoryId categoryName isNewCategory reason
        preview { matchedSeconds changeableSeconds entries { app context } }
      }
    }`);

    expect(suggestRules).toEqual([
      {
        app: 'firefox',
        context: 'shop.example',
        seconds: 20,
        appPattern: '^firefox$',
        contextPattern: exactPattern('shop.example'),
        categoryId: null,
        categoryName: 'Shopping',
        isNewCategory: true,
        reason: 'A store.',
        preview: {
          matchedSeconds: 20,
          changeableSeconds: 20,
          entries: [{ app: 'firefox', context: 'shop.example' }],
        },
      },
      expect.objectContaining({
        app: 'slack',
        context: null,
        appPattern: '^slack$',
        contextPattern: null,
        categoryId: 'cat-work',
        categoryName: 'Work',
        isNewCategory: false,
      }),
      expect.objectContaining({ app: 'terminal', context: null, contextPattern: null }),
    ]);
    expect(exactPattern('shop.example')).toBe('^shop\\.example$');

    // Suggestions only: no rule exists until someone saves one.
    expect(await db.select().from(categoryRules)).toEqual([]);

    // What went out: names and totals, the key as a bearer token, no titles.
    const sent = endpoint.requests.at(-1)!;
    expect(sent.auth).toBe('Bearer sk-test-secret');
    expect(sent.body.model).toBe('test-model');
    expect(lastUserMessage()).toContain('firefox — shop.example');
    expect(lastUserMessage()).toContain('Work (work)');
    expect(JSON.stringify(sent.body)).not.toContain('private title');
  });

  it('sends window titles only when asked to', async () => {
    await configure();
    endpoint.reply = '{"suggestions": []}';
    await data(`{ suggestRules(${RANGE}, includeTitles: true) { app } }`);
    expect(lastUserMessage()).toContain('Cart (3) — a private title');
    expect(lastUserMessage()).toContain('general — team');
  });

  it('finds the JSON in a chatty reply, and skips the model when nothing is uncategorized', async () => {
    await configure();
    endpoint.reply =
      'Sure! Here you go:\n```json\n{"suggestions": [{"entry": 2, "scope": "app", "category": "Work", "reason": "chat"}]}\n```';
    const { suggestRules } = await data<{ suggestRules: { app: string }[] }>(
      `{ suggestRules(${RANGE}) { app } }`,
    );
    expect(suggestRules).toEqual([{ app: 'slack' }]);

    endpoint.requests = [];
    const empty = await data<{ suggestRules: unknown[] }>(
      '{ suggestRules(from: "2026-01-01", to: "2026-01-02") { app } }',
    );
    expect(empty.suggestRules).toEqual([]);
    expect(endpoint.requests).toEqual([]);
  });

  it('drafts a standup from the day’s totals', async () => {
    await configure();
    endpoint.reply = '- Mostly shopping and chat.\n- A little terminal work.';
    const { draftStandup } = await data<{ draftStandup: { day: string; text: string } }>(
      '{ draftStandup(day: "2026-08-16") { day text } }',
    );
    expect(draftStandup).toEqual({
      day: '2026-08-16',
      text: '- Mostly shopping and chat.\n- A little terminal work.',
    });
    expect(lastUserMessage()).toContain('Day: 2026-08-16');
    expect(lastUserMessage()).toContain('Uncategorized');
    expect(lastUserMessage()).not.toContain('private title');
  });

  it('says the model failed without leaking the key, and keys can’t spend it', async () => {
    await configure();
    endpoint.status = 404;
    const result = await run('{ draftStandup(day: "2026-08-16") { text } }');
    expect(result.errors?.[0]?.extensions?.code).toBe('UNAVAILABLE');
    expect(result.errors?.[0]?.message).toContain('test-model');
    expect(JSON.stringify(result)).not.toContain('sk-test-secret');

    expect(await code(`{ suggestRules(${RANGE}) { app } }`, as('admin', 'key-1'))).toBe(
      'UNAUTHENTICATED',
    );
  });
});
