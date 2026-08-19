import { graphql } from 'graphql';
import { beforeEach, describe, expect, it } from 'vitest';
import { createAuth, createAuthGateway } from '../src/auth.ts';
import type { Context } from '../src/graphql/context.ts';
import { createSchema } from '../src/graphql/schema.ts';
import { createMigratedTestDb } from './helpers/test-db.ts';

// End-to-end auth over GraphQL only — the server mounts no better-auth REST
// routes, so signUp/signIn/signOut mutations plus the bearer header are the
// whole flow.
describe('graphql auth flow', () => {
  let db: Awaited<ReturnType<typeof createMigratedTestDb>>;
  let auth: ReturnType<typeof createAuth>;
  let schema: ReturnType<typeof createSchema>;

  beforeEach(async () => {
    db = await createMigratedTestDb();
    auth = createAuth(db as never, {
      secret: 'test-secret-test-secret-test-secret',
      baseURL: 'http://localhost:4000',
    });
    schema = createSchema(db as never, createAuthGateway(auth));
  });

  const anonymous = (): Context =>
    ({ db, userId: undefined, deviceId: undefined, headers: new Headers() }) as Context;

  const bearerHeaders = (token: string) => new Headers({ authorization: `Bearer ${token}` });

  const signUp = () =>
    graphql({
      schema,
      source: `mutation {
        signUp(email: "u@example.com", password: "hunter2hunter2", name: "u") { token userId }
      }`,
      contextValue: anonymous(),
    });

  it('signs up and the returned token authenticates via the bearer header', async () => {
    const result = await signUp();

    expect(result.errors).toBeUndefined();
    const { token, userId } = (result.data as any).signUp;
    expect(token.length).toBeGreaterThan(10);

    // The raw token in an Authorization header resolves the session — this is
    // exactly what the yoga context does per request.
    const session = await auth.api.getSession({ headers: bearerHeaders(token) });
    expect(session?.user.id).toBe(userId);
  });

  it('signs in with the right password and rejects the wrong one', async () => {
    await signUp();

    const good = await graphql({
      schema,
      source: `mutation {
        signIn(email: "u@example.com", password: "hunter2hunter2") { token userId }
      }`,
      contextValue: anonymous(),
    });
    expect(good.errors).toBeUndefined();
    expect((good.data as any).signIn.token.length).toBeGreaterThan(10);

    const bad = await graphql({
      schema,
      source: `mutation {
        signIn(email: "u@example.com", password: "wrong-password") { token }
      }`,
      contextValue: anonymous(),
    });
    expect(bad.errors).toBeDefined();
    expect((bad.data as any)?.signIn ?? null).toBeNull();
  });

  it('signOut revokes the session the request carries', async () => {
    const { token } = ((await signUp()).data as any).signUp;

    const result = await graphql({
      schema,
      source: 'mutation { signOut }',
      contextValue: { ...anonymous(), headers: bearerHeaders(token) },
    });

    expect(result.errors).toBeUndefined();
    expect((result.data as any).signOut).toBe(true);
    expect(await auth.api.getSession({ headers: bearerHeaders(token) })).toBeNull();
  });

  it('signOut without a session reports false instead of erroring', async () => {
    const result = await graphql({
      schema,
      source: 'mutation { signOut }',
      contextValue: anonymous(),
    });

    expect(result.errors).toBeUndefined();
    expect((result.data as any).signOut).toBe(false);
  });
});
