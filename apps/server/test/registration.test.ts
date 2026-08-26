import { graphql } from 'graphql';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type Auth, createAuth, createAuthGateway } from '../src/auth.ts';
import type { Context } from '../src/graphql/context.ts';
import { createSchema } from '../src/graphql/schema.ts';
import type { RegistrationPolicy } from '../src/registration.ts';
import { createMigratedTestDb } from './helpers/test-db.ts';

// better-auth's own `disableSignUp` still emails a magic link to a stranger and
// only refuses at verify time, so the gating has to happen when the request
// arrives — which is what these cover, along with the login rate limit.
describe('registration policy', () => {
  let db: Awaited<ReturnType<typeof createMigratedTestDb>>;
  let auth: Auth;
  let sendMagicLink: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    db = await createMigratedTestDb();
    sendMagicLink = vi.fn(async () => {});
    auth = createAuth(db as never, {
      secret: 'test-secret-test-secret-test-secret',
      baseURL: 'http://localhost:4000',
      sendMagicLink: sendMagicLink as never,
    });
  });

  const anonymous = (): Context =>
    ({ db, userId: undefined, deviceId: undefined, headers: new Headers() }) as Context;

  const makeSchema = (registration: RegistrationPolicy) =>
    createSchema(db as never, createAuthGateway(auth, db as never, { registration }));

  const run = (schema: ReturnType<typeof createSchema>, source: string, variables = {}) =>
    graphql({ schema, source, variableValues: variables, contextValue: anonymous() });

  const signUp = (schema: ReturnType<typeof createSchema>, email: string) =>
    run(
      schema,
      'mutation ($e: String!) { signUp(email: $e, password: "hunter2hunter2", name: "T") { userId } }',
      {
        e: email,
      },
    );

  const requestLink = (schema: ReturnType<typeof createSchema>, email: string) =>
    run(schema, 'mutation ($e: String!) { requestMagicLink(email: $e) { ok token } }', {
      e: email,
    });

  const code = (result: Awaited<ReturnType<typeof run>>): unknown =>
    result.errors?.[0]?.extensions?.code;

  describe('with an allowlist', () => {
    const policy: RegistrationPolicy = {
      allowedEmails: ['me@example.com', '*@work.test'],
      disableSignUp: false,
    };

    it('turns away an address that is not on it, on every entry point', async () => {
      const schema = makeSchema(policy);

      const link = await requestLink(schema, 'stranger@evil.com');
      expect(code(link)).toBe('FORBIDDEN');
      expect(sendMagicLink).not.toHaveBeenCalled();

      expect(code(await signUp(schema, 'stranger@evil.com'))).toBe('FORBIDDEN');
      expect(
        code(
          await run(
            schema,
            'mutation { signIn(email: "stranger@evil.com", password: "hunter2hunter2") { userId } }',
          ),
        ),
      ).toBe('FORBIDDEN');
    });

    it('lets listed addresses and listed domains through', async () => {
      const schema = makeSchema(policy);

      expect((await requestLink(schema, 'me@example.com')).errors).toBeUndefined();
      expect((await requestLink(schema, 'anyone@work.test')).errors).toBeUndefined();
      expect(sendMagicLink).toHaveBeenCalledTimes(2);
    });
  });

  describe('with sign-ups closed', () => {
    const policy: RegistrationPolicy = { allowedEmails: [], disableSignUp: true };

    it('refuses to create an account', async () => {
      const result = await signUp(makeSchema(policy), 'new@example.com');
      expect(code(result)).toBe('FORBIDDEN');
    });

    it('emails a link to an existing account but not to a stranger', async () => {
      // The account has to exist first, so make it while sign-ups are open.
      const open = makeSchema({ allowedEmails: [], disableSignUp: false });
      expect((await signUp(open, 'member@example.com')).errors).toBeUndefined();

      const closed = makeSchema(policy);
      expect((await requestLink(closed, 'member@example.com')).errors).toBeUndefined();
      expect(sendMagicLink).toHaveBeenCalledOnce();

      // Silent, not FORBIDDEN: the response must not reveal which addresses
      // have accounts here.
      const stranger = await requestLink(closed, 'nobody@example.com');
      expect(stranger.errors).toBeUndefined();
      expect((stranger.data as any).requestMagicLink).toEqual({ ok: true, token: null });
      expect(sendMagicLink).toHaveBeenCalledOnce();
    });
  });

  it('rate-limits repeated sign-in attempts for one address', async () => {
    const schema = makeSchema({ allowedEmails: [], disableSignUp: false });

    // The limit is 5 per address per window; each of these sends mail.
    for (let i = 0; i < 5; i++) {
      expect((await requestLink(schema, 'flood@example.com')).errors).toBeUndefined();
    }
    const blocked = await requestLink(schema, 'flood@example.com');
    expect(code(blocked)).toBe('RATE_LIMITED');
    expect(sendMagicLink).toHaveBeenCalledTimes(5);

    // Another address still gets served — the cap is per address.
    expect((await requestLink(schema, 'someone@example.com')).errors).toBeUndefined();
  });
});
