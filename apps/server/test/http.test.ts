import { type Ping, uploadBatch } from '@eunomia/agent';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
    const reg = await query(
      'mutation { registerDevice(name: "desk", platform: "linux") { apiKey } }',
      {
        authorization: `Bearer ${token}`,
      },
    );
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

  // The two ends of the upload contract meeting: the agent's real uploadBatch,
  // its committed operation document, and this server. Both directions of
  // "was the batch taken?" were once decided wrongly, and each mistake lost or
  // stalled real data — so they are asserted against the actual server rather
  // than a hand-written response body.
  describe('agent uploads', () => {
    afterEach(() => vi.unstubAllGlobals());

    const asAgent = (apiKey: string) => {
      vi.stubGlobal('fetch', (url: string, init: RequestInit) => app.fetch(url, init));
      return { serverUrl: 'http://server.test', apiKey };
    };

    const idle = (capturedAt: string): Ping => ({
      capturedAt,
      app: 'code',
      title: null,
      context: null,
      idleSeconds: 600,
    });

    it('retries a batch a bad key rejected, rather than dropping it', async () => {
      // The shape that used to lose data: HTTP 200 with the refusal in the
      // body, which the agent read as success and discarded the pings for.
      const result = await uploadBatch(asAgent('revoked-or-never-valid'), [
        idle('2026-08-10T09:00:00Z'),
      ]);

      expect(result).toEqual({ accepted: false, error: 'Not authenticated' });
    });

    it('accepts a batch of idle pings instead of retrying it forever', async () => {
      // recordPings answers 0 — an hour away from the keyboard, not a failure.
      // Reading it as one stalled the outbox: the batch came back forever and
      // every later ping queued behind it.
      const reg = await query(
        'mutation { registerDevice(name: "desk", platform: "linux") { apiKey } }',
        { authorization: `Bearer ${await signIn()}` },
      );
      const { apiKey } = reg.body.data?.registerDevice as { apiKey: string };

      const result = await uploadBatch(asAgent(apiKey), [
        idle('2026-08-10T09:00:00Z'),
        idle('2026-08-10T09:00:10Z'),
      ]);

      expect(result).toEqual({ accepted: true, error: null });
    });

    it('records a batch in one call and folds it as if the pings arrived apart', async () => {
      const bearer = { authorization: `Bearer ${await signIn()}` };
      const reg = await query(
        'mutation { registerDevice(name: "desk", platform: "linux") { apiKey } }',
        bearer,
      );
      const { apiKey } = reg.body.data?.registerDevice as { apiKey: string };

      const at = (seconds: number) =>
        new Date(Date.parse('2026-08-10T09:00:00Z') + seconds * 1000).toISOString();
      const active = (seconds: number): Ping => ({ ...idle(at(seconds)), idleSeconds: 0 });

      const result = await uploadBatch(asAgent(apiKey), [active(0), active(10), active(20)]);
      expect(result).toEqual({ accepted: true, error: null });

      // One activity, and the elapsed time between the pings accrued to it —
      // the batch folds exactly as three separate uploads would have.
      const { body } = await query('{ activities { app activeSeconds } }', bearer);
      expect(body.data?.activities).toEqual([{ app: 'code', activeSeconds: 20 }]);
    });
  });
});
