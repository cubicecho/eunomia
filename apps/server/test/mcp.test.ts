import { createServer, type Server } from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp, createContextFactory } from '../src/app.ts';
import { type Auth, createAuth, createAuthGateway } from '../src/auth.ts';
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

  beforeEach(async () => {
    db = await createMigratedTestDb();
    auth = createAuth(db as never, {
      secret: 'test-secret-test-secret-test-secret',
      baseURL: 'http://server.test',
    });
    const gateway = createAuthGateway(auth, db as never);
    const schema = createSchema(db as never, gateway);
    app = createApp(db as never, auth, gateway, schema);

    const handler = createMcpHandler(schema, createContextFactory(db as never, auth));
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
      'device_summary',
      'devices',
      'me',
      'merge_rules',
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
});
