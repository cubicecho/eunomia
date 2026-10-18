import { createServer, type Server } from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp, createContextFactory } from '../src/app.ts';
import { type Auth, createAuth, createAuthGateway } from '../src/auth.ts';
import { fixedAuthHost } from '../src/auth-host.ts';
import { createSchema } from '../src/graphql/schema.ts';
import { createMcpHandler } from '../src/mcp.ts';
import { createMigratedTestDb } from './helpers/test-db.ts';

// Drives /mcp the way an agent would: the real MCP SDK client over the real
// Streamable HTTP transport against a real node server. The point of the
// endpoint is that it is the same API as /graphql — same schema instance, same
// permissions — so what's asserted here is the surface (queries only) and that
// identity is enforced, not the resolvers, which the GraphQL tests own.

interface TextResult {
  content: { type: string; text: string }[];
  isError?: boolean;
}

describe('mcp over http', () => {
  let db: Awaited<ReturnType<typeof createMigratedTestDb>>;
  let auth: Auth;
  let server: Server;
  let url: URL;
  let app: ReturnType<typeof createApp>;

  /** Connects an MCP client, optionally carrying an auth header. */
  const connect = async (headers: Record<string, string> = {}): Promise<Client> => {
    const client = new Client({ name: 'test', version: '0.0.0' });
    await client.connect(new StreamableHTTPClientTransport(url, { requestInit: { headers } }));
    return client;
  };

  /** A real bearer session, the way the dashboard gets one. */
  const signIn = async (): Promise<string> => {
    const response = await app.fetch('http://server.test/graphql', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        query: `mutation {
          signUp(email: "u@example.com", password: "hunter2hunter2", name: "u") { token }
        }`,
      }),
    });
    const body = (await response.json()) as { data: { signUp: { token: string } } };
    return body.data.signUp.token;
  };

  /** An integration key, minted the way the dashboard mints one. */
  const mintKey = async (token: string, scopes: string[] = []): Promise<string> => {
    const response = await app.fetch('http://server.test/graphql', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({
        query: `mutation ($scopes: [ApiKeyScope!]) {
          createApiKey(name: "assistant", scopes: $scopes) { token key { scopes } }
        }`,
        variables: { scopes },
      }),
    });
    const body = (await response.json()) as {
      data: { createApiKey: { token: string; key: { scopes: string[] } } };
    };
    expect(body.data.createApiKey.key.scopes).toEqual(scopes);
    return body.data.createApiKey.token;
  };

  const toolNames = async (client: Client) =>
    (await client.listTools()).tools.map((tool) => tool.name);

  beforeEach(async () => {
    db = await createMigratedTestDb();
    auth = createAuth(db as never, {
      secret: 'test-secret-test-secret-test-secret',
      baseURL: 'http://server.test',
    });
    const gateway = createAuthGateway(fixedAuthHost(auth), db as never);
    const schema = createSchema(db as never, gateway);
    app = createApp(db as never, fixedAuthHost(auth), gateway, schema);

    const handler = createMcpHandler(
      schema,
      createContextFactory(db as never, fixedAuthHost(auth)),
    );
    server = createServer((req, res) => void handler(req, res));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as { port: number };
    url = new URL(`http://127.0.0.1:${port}/mcp`);
  });

  afterEach(() => {
    server.close();
  });

  it('exposes the reads as tools and no mutations at all', async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    const names = tools.map((tool) => tool.name).sort();

    // snake_case is what graphql-mcp projects field names to — the convention
    // agents see across MCP servers, not the schema's spelling.
    expect(names).toEqual([
      'activities',
      'api_keys',
      'app_summary',
      'categories',
      'category_rules',
      'category_summary',
      'context_rules',
      'day_summary',
      'device_summary',
      'devices',
      'focus_segments',
      'me',
      'merge_rules',
      'preview_category_rule',
      'rule_packs',
      'search_activity',
      'uncategorized',
    ]);
    // The dangerous half: signIn and registerDevice are mutations, and an agent
    // that could call them would be minting credentials, not reading data.
    expect(names).not.toContain('sign_in');
    expect(names).not.toContain('register_device');
    expect(names).not.toContain('record_ping');
  });

  it('describes a tool from the SDL, so an agent knows the date format', async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    const summary = tools.find((tool) => tool.name === 'category_summary');

    expect(summary?.description).toContain('YYYY-MM-DD');
    expect(summary?.annotations?.readOnlyHint).toBe(true);
  });

  it('refuses an anonymous tool call, the way /graphql does', async () => {
    const client = await connect();
    const result = (await client.callTool({
      name: 'devices',
      arguments: {},
    })) as unknown as TextResult;

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('Not authenticated');
  });

  it('answers a session bearer with that user’s own rows', async () => {
    const token = await signIn();
    const client = await connect({ authorization: `Bearer ${token}` });
    const result = (await client.callTool({
      name: 'devices',
      arguments: {},
    })) as unknown as TextResult;

    expect(result.isError).toBeFalsy();
    // The tool hands back the whole GraphQL envelope, errors included.
    expect(JSON.parse(result.content[0]!.text)).toEqual({ data: { devices: [] } });
  });

  it('rejects a malformed body rather than throwing', async () => {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not json',
    });

    expect(response.status).toBe(400);
  });

  describe('categorization write tools', () => {
    const writes = [
      'apply_category_rules',
      'assign_activity',
      'assign_entry',
      'create_category',
      'create_category_rule',
    ];

    it('are only for a key minted with the CATEGORIZE scope', async () => {
      const token = await signIn();
      const plain = await connect({ 'x-api-key': await mintKey(token) });
      const scoped = await connect({ 'x-api-key': await mintKey(token, ['CATEGORIZE']) });
      const session = await connect({ authorization: `Bearer ${token}` });

      for (const client of [plain, session]) {
        const names = await toolNames(client);
        for (const name of writes) expect(names).not.toContain(name);
      }
      const names = await toolNames(scoped);
      for (const name of writes) expect(names).toContain(name);
      // Still nothing else that writes.
      expect(names).not.toContain('delete_range');
      expect(names).not.toContain('create_api_key');
      expect(names).not.toContain('register_device');
    });

    it('write as the key’s owner, and a key without the scope cannot call them by name', async () => {
      const token = await signIn();
      const scoped = await connect({ 'x-api-key': await mintKey(token, ['CATEGORIZE']) });
      const created = (await scoped.callTool({
        name: 'create_category',
        arguments: { name: 'Deep work', kind: 'focus' },
      })) as unknown as TextResult;
      expect(created.isError).toBeFalsy();
      expect(JSON.parse(created.content[0]!.text).data.createCategory.name).toBe('Deep work');

      const plain = await connect({ 'x-api-key': await mintKey(token) });
      const refused = (await plain.callTool({
        name: 'create_category',
        arguments: { name: 'Nope' },
      })) as unknown as TextResult;
      expect(refused.isError).toBe(true);
    });
  });

  describe('prompts', () => {
    it('offers standup, weekly review and triage', async () => {
      const client = await connect();
      const { prompts } = await client.listPrompts();
      expect(prompts.map((prompt) => prompt.name).sort()).toEqual([
        'categorize_triage',
        'standup',
        'weekly_review',
      ]);
      const standup = prompts.find((prompt) => prompt.name === 'standup');
      expect(standup?.arguments).toEqual([
        expect.objectContaining({ name: 'day', required: false }),
      ]);
    });

    it('fill in the caller’s own data', async () => {
      const token = await signIn();
      const client = await connect({ 'x-api-key': await mintKey(token) });
      const result = await client.getPrompt({ name: 'standup', arguments: { day: '2026-08-16' } });
      const text = (result.messages[0]!.content as { text: string }).text;
      expect(text).toContain('standup for 2026-08-16');
      expect(text).toContain('"day": "2026-08-15"');
      expect(text).toContain('"totalSeconds": 0');

      const triage = await client.getPrompt({ name: 'categorize_triage', arguments: {} });
      // A key without the scope is told it can't write, not pointed at tools it lacks.
      expect((triage.messages[0]!.content as { text: string }).text).toContain("can't write");
    });

    it('refuse an anonymous caller', async () => {
      const client = await connect();
      await expect(client.getPrompt({ name: 'weekly_review', arguments: {} })).rejects.toThrow(
        /Not authenticated/,
      );
    });

    it('check their arguments', async () => {
      const token = await signIn();
      const client = await connect({ 'x-api-key': await mintKey(token) });
      await expect(
        client.getPrompt({ name: 'standup', arguments: { day: 'yesterday' } }),
      ).rejects.toThrow(/YYYY-MM-DD/);
    });
  });
});
