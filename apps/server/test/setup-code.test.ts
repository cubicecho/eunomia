import { eq } from 'drizzle-orm';
import { graphql } from 'graphql';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type Auth, createAuth, createAuthGateway } from '../src/auth.ts';
import { fixedAuthHost } from '../src/auth-host.ts';
import { user } from '../src/db/schema.ts';
import type { Context } from '../src/graphql/context.ts';
import { createSchema } from '../src/graphql/schema.ts';
import { storedSessionSecret } from '../src/instance-secret.ts';
import type { RegistrationPolicy } from '../src/registration.ts';
import { generateSetupCode, SetupCode } from '../src/setup-code.ts';
import { createMigratedTestDb } from './helpers/test-db.ts';

describe('setup code', () => {
  it('reads cleanly and forgives case, spaces and dashes', () => {
    const code = generateSetupCode();
    expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(code).not.toMatch(/[01OILU]/);

    const setup = new SetupCode('ABCD-EFGH-JKMN');
    expect(setup.take('abcd efgh-jkm')).toBe(false);
    expect(setup.value).toBe('ABCD-EFGH-JKMN');
    expect(setup.take(' abcd efgh jkmn ')).toBe(true);
    expect(setup.value).toBeNull();
    expect(setup.take('ABCD-EFGH-JKMN')).toBe(false);
  });
});

describe('first account from the setup code', () => {
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

  const ctx = (who: Partial<Context> = {}): Context =>
    ({
      db,
      userId: undefined,
      deviceId: undefined,
      keyId: undefined,
      headers: new Headers(),
      ...who,
    }) as Context;

  const run = (
    setup: SetupCode | undefined,
    source: string,
    who: Partial<Context> = {},
    registration?: RegistrationPolicy,
  ) =>
    graphql({
      schema: createSchema(
        db as never,
        createAuthGateway(fixedAuthHost(auth), db as never, {
          setupCode: setup,
          ...(registration ? { registration } : {}),
        }),
      ),
      source,
      contextValue: ctx(who),
    });

  const claim = (setup: SetupCode | undefined, code: string, email = 'me@example.com') =>
    run(setup, `mutation { claimSetupCode(code: "${code}", email: "${email}") { token userId } }`);

  it('makes the first account, as the admin, without sending email', async () => {
    const setup = new SetupCode('ABCD-EFGH-JKMN');
    expect((await run(setup, '{ setupCodePending }')).data).toEqual({ setupCodePending: true });

    const wrong = await claim(setup, 'ABCD-EFGH-JKMP');
    expect(wrong.errors?.[0]?.extensions?.code).toBe('BAD_USER_INPUT');

    const result = await claim(setup, 'abcd-efgh-jkmn', 'Me@Example.com');
    expect(result.errors).toBeUndefined();
    const session = (result.data as { claimSetupCode: { token: string; userId: string } })
      .claimSetupCode;
    expect(session.token).toBeTruthy();

    const [created] = await db.select().from(user).where(eq(user.id, session.userId));
    expect(created).toMatchObject({ email: 'me@example.com', isAdmin: true, emailVerified: true });
    expect(sendMagicLink).not.toHaveBeenCalled();

    // The session works.
    const me = await auth.api.getSession({
      headers: new Headers({ authorization: `Bearer ${session.token}` }),
    });
    expect(me?.user.id).toBe(session.userId);

    expect((await run(setup, '{ setupCodePending }')).data).toEqual({ setupCodePending: false });
  });

  it('is refused once any account exists, however it was made', async () => {
    const setup = new SetupCode('ABCD-EFGH-JKMN');
    await db.insert(user).values({ id: 'u1', name: '', email: 'first@example.com' });

    expect((await run(setup, '{ setupCodePending }')).data).toEqual({ setupCodePending: false });
    const result = await claim(setup, 'ABCD-EFGH-JKMN');
    expect(result.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
    // Refused before the code was looked at, so it wasn't spent either.
    expect(setup.value).toBe('ABCD-EFGH-JKMN');
  });

  it('is refused on a server that booted with accounts (no code at all)', async () => {
    expect((await run(undefined, '{ setupCodePending }')).data).toEqual({
      setupCodePending: false,
    });
    expect((await claim(undefined, 'ABCD-EFGH-JKMN')).errors?.[0]?.extensions?.code).toBe(
      'FORBIDDEN',
    );
  });

  it('still keeps to ALLOWED_EMAILS', async () => {
    const setup = new SetupCode('ABCD-EFGH-JKMN');
    const result = await run(
      setup,
      'mutation { claimSetupCode(code: "ABCD-EFGH-JKMN", email: "me@example.com") { token } }',
      {},
      { allowedEmails: ['*@elsewhere.org'], disableSignUp: false },
    );
    expect(result.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
    expect(setup.value).toBe('ABCD-EFGH-JKMN');
  });

  it('works with sign-ups closed: that is what closing them is waiting on', async () => {
    const setup = new SetupCode('ABCD-EFGH-JKMN');
    const result = await run(
      setup,
      'mutation { claimSetupCode(code: "ABCD-EFGH-JKMN", email: "me@example.com") { token } }',
      {},
      { allowedEmails: [], disableSignUp: true },
    );
    expect(result.errors).toBeUndefined();
  });
});

describe('device sign-in link', () => {
  let db: Awaited<ReturnType<typeof createMigratedTestDb>>;
  let auth: Auth;
  let sendMagicLink: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    db = await createMigratedTestDb();
    sendMagicLink = vi.fn(async () => {});
    auth = createAuth(db as never, {
      secret: 'test-secret-test-secret-test-secret',
      baseURL: 'http://localhost:4000',
      appUrl: 'http://localhost:4000',
      sendMagicLink: sendMagicLink as never,
    });
    await db.insert(user).values({ id: 'u1', name: '', email: 'me@example.com' });
  });

  const link = (who: Partial<Context>) =>
    graphql({
      schema: createSchema(db as never, createAuthGateway(fixedAuthHost(auth), db as never)),
      source: 'mutation { deviceSignInLink }',
      contextValue: {
        db,
        userId: undefined,
        deviceId: undefined,
        keyId: undefined,
        headers: new Headers(),
        ...who,
      } as Context,
    });

  it("hands a signed-in person a link for their own address, and doesn't email it", async () => {
    const result = await link({ userId: 'u1' });
    expect(result.errors).toBeUndefined();
    const url = new URL((result.data as { deviceSignInLink: string }).deviceSignInLink);
    const token = url.searchParams.get('token');
    expect(token).toBeTruthy();
    expect(sendMagicLink).not.toHaveBeenCalled();

    const verified = await auth.api.magicLinkVerify({
      query: { token: token! },
      headers: new Headers(),
    });
    expect(verified.user.id).toBe('u1');
  });

  it('is refused to API keys and to nobody', async () => {
    expect((await link({ userId: 'u1', keyId: 'k1' })).errors?.[0]?.extensions?.code).toBe(
      'UNAUTHENTICATED',
    );
    expect((await link({})).errors?.[0]?.extensions?.code).toBe('UNAUTHENTICATED');
  });
});

describe('stored session secret', () => {
  it('is made once and then read back', async () => {
    const db = await createMigratedTestDb();
    const first = await storedSessionSecret(db as never);
    const second = await storedSessionSecret(db as never);
    expect(first.created).toBe(true);
    expect(second).toEqual({ secret: first.secret, created: false });
    expect(Buffer.from(first.secret, 'base64')).toHaveLength(32);
  });
});
