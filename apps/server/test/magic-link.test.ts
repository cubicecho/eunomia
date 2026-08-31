import { graphql } from 'graphql';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAuth, createAuthGateway } from '../src/auth.ts';
import type { Context } from '../src/graphql/context.ts';
import { createSchema } from '../src/graphql/schema.ts';
import { createMigratedTestDb } from './helpers/test-db.ts';

// Magic-link login over GraphQL only: requestMagicLink emails a link (or, in
// UNSAFE_LOCAL_NETWORK mode, returns the token directly) and verifyMagicLink
// consumes it into a bearer session.
describe('magic-link auth', () => {
  let db: Awaited<ReturnType<typeof createMigratedTestDb>>;
  let sendMagicLink: ReturnType<typeof vi.fn>;
  let auth: ReturnType<typeof createAuth>;

  beforeEach(async () => {
    db = await createMigratedTestDb();
    sendMagicLink = vi.fn(async () => {});
    auth = createAuth(db as never, {
      secret: 'test-secret-test-secret-test-secret',
      baseURL: 'http://localhost:4000',
      appUrl: 'http://dashboard.test',
      sendMagicLink: sendMagicLink as never,
    });
  });

  const anonymous = (): Context =>
    ({
      db,
      userId: undefined,
      deviceId: undefined,
      keyId: undefined,
      headers: new Headers(),
    }) as Context;

  const makeSchema = (exposeMagicLinkToken: boolean) =>
    createSchema(db as never, createAuthGateway(auth, db as never, { exposeMagicLinkToken }));

  const request = (schema: ReturnType<typeof createSchema>) =>
    graphql({
      schema,
      source: `mutation { requestMagicLink(email: "Link@Example.com") { ok token } }`,
      contextValue: anonymous(),
    });

  const verify = (schema: ReturnType<typeof createSchema>, token: string) =>
    graphql({
      schema,
      source: 'mutation ($token: String!) { verifyMagicLink(token: $token) { token userId } }',
      variableValues: { token },
      contextValue: anonymous(),
    });

  it('emails a dashboard link and never leaks the token by default', async () => {
    const schema = makeSchema(false);
    const result = await request(schema);

    expect(result.errors).toBeUndefined();
    expect((result.data as any).requestMagicLink).toEqual({ ok: true, token: null });

    expect(sendMagicLink).toHaveBeenCalledOnce();
    const message = sendMagicLink.mock.calls[0]![0] as {
      email: string;
      url: string;
      token: string;
    };
    expect(message.email).toBe('link@example.com');
    expect(message.url).toBe(`http://dashboard.test/?token=${encodeURIComponent(message.token)}`);
  });

  it('the emailed token verifies into a working bearer session, exactly once', async () => {
    const schema = makeSchema(false);
    await request(schema);
    const { token } = sendMagicLink.mock.calls[0]![0] as { token: string };

    const result = await verify(schema, token);
    expect(result.errors).toBeUndefined();
    const session = (result.data as any).verifyMagicLink;

    const live = await auth.api.getSession({
      headers: new Headers({ authorization: `Bearer ${session.token}` }),
    });
    expect(live?.user.id).toBe(session.userId);
    expect(live?.user.email).toBe('link@example.com');

    // Single-use: a replayed link must not mint a second session.
    const replay = await verify(schema, token);
    expect(replay.errors).toBeDefined();
  });

  it('UNSAFE_LOCAL_NETWORK returns the token in the response and skips email', async () => {
    const schema = makeSchema(true);
    const result = await request(schema);

    expect(result.errors).toBeUndefined();
    const { ok, token } = (result.data as any).requestMagicLink;
    expect(ok).toBe(true);
    expect(token).toBeTruthy();
    expect(sendMagicLink).not.toHaveBeenCalled();

    const session = await verify(schema, token);
    expect(session.errors).toBeUndefined();
    expect((session.data as any).verifyMagicLink.token.length).toBeGreaterThan(10);
  });

  it('rejects garbage tokens', async () => {
    const schema = makeSchema(false);
    const result = await verify(schema, 'not-a-real-token');
    expect(result.errors).toBeDefined();
    expect(result.data?.verifyMagicLink ?? null).toBeNull();
  });
});
