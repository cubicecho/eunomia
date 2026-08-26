import { classifyResponse } from '@eunomia/agent';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.ts';
import { type Auth, createAuth, createAuthGateway } from '../src/auth.ts';
import { stubAuthGateway } from './helpers/stub-auth.ts';
import { createMigratedTestDb } from './helpers/test-db.ts';

// The only tests that go through Yoga rather than calling graphql() directly.
// That gap mattered: Yoga masks any plain Error a resolver throws into
// "Unexpected error." / INTERNAL_SERVER_ERROR, so every domain message the
// resolvers raise was invisible to clients while the direct-call tests kept
// asserting on it happily.

interface GraphQLBody {
  data?: Record<string, unknown> | null;
  errors?: { message: string; extensions?: { code?: string } }[];
}

describe('graphql over http', () => {
  let db: Awaited<ReturnType<typeof createMigratedTestDb>>;
  let auth: Auth;
  let app: ReturnType<typeof createApp>;

  const post = async (
    body: unknown,
    headers: Record<string, string> = {},
  ): Promise<{ status: number; body: GraphQLBody }> => {
    const response = await app.fetch('http://server.test/graphql', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: (await response.json()) as GraphQLBody };
  };

  const query = (query: string, headers?: Record<string, string>) => post({ query }, headers);

  /** A real bearer session, the way the dashboard gets one. */
  const signIn = async (): Promise<string> => {
    const { body } = await query(`mutation {
      signUp(email: "u@example.com", password: "hunter2hunter2", name: "u") { token }
    }`);
    return (body.data?.signUp as { token: string }).token;
  };

  beforeEach(async () => {
    db = await createMigratedTestDb();
    auth = createAuth(db as never, {
      secret: 'test-secret-test-secret-test-secret',
      baseURL: 'http://server.test',
    });
    app = createApp(db as never, auth, createAuthGateway(auth, db as never));
  });

  it('answers an anonymous protected query with UNAUTHENTICATED', async () => {
    const { status, body } = await query('{ devices { id } }');

    expect(status).toBe(200); // GraphQL reports errors in the body, not the status
    expect(body.errors?.[0]?.message).toBe('Not authenticated');
    expect(body.errors?.[0]?.extensions?.code).toBe('UNAUTHENTICATED');
  });

  it('passes domain errors through with a code the client can branch on', async () => {
    const token = await signIn();
    const bearer = { authorization: `Bearer ${token}` };

    const missing = await query('mutation { renameDevice(id: "nope", name: "x") { id } }', bearer);
    expect(missing.body.errors?.[0]?.message).toBe('Unknown device');
    expect(missing.body.errors?.[0]?.extensions?.code).toBe('NOT_FOUND');

    const bad = await query('{ appSummary(from: "nope", to: "2026-08-12") { app } }', bearer);
    expect(bad.body.errors?.[0]?.message).toBe('Invalid date range');
    expect(bad.body.errors?.[0]?.extensions?.code).toBe('BAD_USER_INPUT');
  });

  it('still masks genuinely unexpected failures', async () => {
    // Internals stay the server's business — only errors built in errors.ts
    // are meant for the caller.
    app = createApp(
      db as never,
      auth,
      stubAuthGateway({
        signIn: async () => {
          throw new Error('connection string leaked in here');
        },
      }),
    );

    const { body } = await query(
      'mutation { signIn(email: "u@example.com", password: "x") { token } }',
    );
    expect(body.errors?.[0]?.message).toBe('Unexpected error.');
    expect(body.errors?.[0]?.extensions?.code).toBe('INTERNAL_SERVER_ERROR');
  });

  it('trades a device key for a session token the dashboard accepts', async () => {
    // The desktop webview flow: the agent holds only an x-api-key, exchanges
    // it for a bearer session, and the embedded dashboard runs on that.
    const token = await signIn();
    const reg = await query('mutation { registerDevice(name: "desk", platform: "linux") { apiKey } }', {
      authorization: `Bearer ${token}`,
    });
    const apiKey = (reg.body.data?.registerDevice as { apiKey: string }).apiKey;

    const minted = await query('mutation { sessionFromDeviceKey { token userId } }', {
      'x-api-key': apiKey,
    });
    const session = minted.body.data?.sessionFromDeviceKey as { token: string; userId: string };
    expect(session.token).toBeTruthy();

    const devices = await query('{ devices { name } }', {
      authorization: `Bearer ${session.token}`,
    });
    expect(devices.body.errors).toBeUndefined();
    expect(devices.body.data?.devices).toEqual([{ name: 'desk' }]);
  });

  it('refuses to mint a session for anything but a device key', async () => {
    // A stolen bearer token must not be able to breed fresh sessions.
    const bearer = { authorization: `Bearer ${await signIn()}` };
    for (const headers of [bearer, undefined]) {
      const { body } = await query('mutation { sessionFromDeviceKey { token } }', headers);
      expect(body.data).toBeNull();
      expect(body.errors?.[0]?.extensions?.code).toBe('UNAUTHENTICATED');
    }
  });

  it('an agent batch with a bad key is retried, not dropped', async () => {
    // The shape that used to lose data: HTTP 200, every aliased ping null.
    // classifyResponse (the agent's rule) must call this a retry.
    const { status, body } = await post(
      {
        query: `mutation ($c: String!, $i: Int!) {
          p0: recordPing(capturedAt: $c, app: "code", idleSeconds: $i) { id }
          p1: recordPing(capturedAt: $c, app: "code", idleSeconds: $i) { id }
        }`,
        variables: { c: '2026-08-10T09:00:00Z', i: 0 },
      },
      { 'x-api-key': 'revoked-or-never-valid' },
    );

    expect(status).toBe(200);
    expect(body.data).toEqual({ p0: null, p1: null });
    expect(body.errors?.[0]?.extensions?.code).toBe('UNAUTHENTICATED');
    expect(classifyResponse(body)).toEqual({ accepted: false, error: 'Not authenticated' });
  });
});
