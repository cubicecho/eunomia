import { createHash, randomUUID } from 'node:crypto';
import {
  createServer,
  type IncomingMessage,
  type RequestListener,
  type Server,
  type ServerResponse,
} from 'node:http';
import type { AddressInfo } from 'node:net';
import { fetchSsoProvider, provisionDevice, ssoStartUrl, ssoTokenFrom } from '@eunomia/agent';
import { eq } from 'drizzle-orm';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deleteAccount } from '../src/activity/deletion.ts';
import { createApp } from '../src/app.ts';
import { createAuthGateway } from '../src/auth.ts';
import { type AuthHost, createAuthHost } from '../src/auth-host.ts';
import { user } from '../src/db/schema.ts';
import { oidcEnvProblem, SSO_CALLBACK_PATH, SSO_START_PATH } from '../src/oidc/config.ts';
import { s256 } from '../src/oidc/handoff.ts';
import { createSsoHandler } from '../src/oidc/http.ts';
import { PairingFailure, parseSetupUrl } from '../src/oidc/pairing.ts';
import { isAdmin, readPairedOidc } from '../src/oidc/settings.ts';
import { createMigratedTestDb } from './helpers/test-db.ts';

// OIDC sign-in and pairing through the real HTTP surface, against a stand-in
// for heautou (oidc-provider): discovery, a JWKS, a code flow with the client
// secret in a Basic header, PKCE, a signed id token carrying the nonce — and
// Dynamic Client Registration (RFC 7591) with deletion (RFC 7592).

const SECRET = 'test-secret-test-secret-test-secret';
const SETUP_TOKEN = 'iat-good';
const CLIENT_ID = 'eunomia-client';
const CLIENT_SECRET = 'eunomia-secret';
const RAT = 'rat-1';

const SETUP = '{ ssoSetup { source name signInUrl issuer canPair redirectUri } }';
const PAIR = 'mutation ($url: String!) { pairSso(setupUrl: $url) { source name canPair } }';
const UNPAIR = 'mutation { unpairSso { source name signInUrl } }';
const VERIFY = 'mutation ($token: String!) { verifyOneTimeToken(token: $token) { token userId } }';

interface Profile {
  sub: string;
  email?: string;
  name?: string;
  preferred_username?: string;
}

interface FakeProvider {
  issuer: string;
  /** Who the next sign-in is. */
  profile: Profile;
  /** What discovery says the issuer is. Set to something else to forge it. */
  claimedIssuer: string;
  canRegister: boolean;
  registerAnswer: 'created' | 'badRedirect' | 'rateLimited';
  registrations: { body: Record<string, unknown>; authorization: string | undefined }[];
  deletions: (string | undefined)[];
  deleteStatus: number;
  /** Plays the browser at the authorize endpoint: the code and state it would be sent back with. */
  authorize(url: string): { code: string; state: string };
  close(): Promise<void>;
}

async function listen(handler: RequestListener): Promise<{ server: Server; origin: string }> {
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
}

function close(server: Server): Promise<void> {
  return new Promise((resolve) => {
    server.closeAllConnections();
    server.close(() => resolve());
  });
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function startProvider(): Promise<FakeProvider> {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
  const codes = new Map<
    string,
    { nonce: string; challenge: string; redirectUri: string; profile: Profile }
  >();
  let fake!: FakeProvider;

  const { server, origin } = await listen((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? '/', 'http://provider');
      const issuer = fake.issuer;
      if (url.pathname === '/oidc/.well-known/openid-configuration') {
        sendJson(res, 200, {
          issuer: fake.claimedIssuer,
          authorization_endpoint: `${issuer}/auth`,
          token_endpoint: `${issuer}/token`,
          userinfo_endpoint: `${issuer}/me`,
          jwks_uri: `${issuer}/jwks`,
          ...(fake.canRegister ? { registration_endpoint: `${issuer}/reg` } : {}),
          id_token_signing_alg_values_supported: ['RS256'],
          token_endpoint_auth_methods_supported: ['client_secret_basic'],
        });
      } else if (url.pathname === '/oidc/jwks') {
        sendJson(res, 200, { keys: [jwk] });
      } else if (url.pathname === '/oidc/token' && req.method === 'POST') {
        const basic = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');
        if (req.headers.authorization !== `Basic ${basic}`) {
          sendJson(res, 401, { error: 'invalid_client' });
          return;
        }
        const form = new URLSearchParams(await readBody(req));
        const code = form.get('code') ?? '';
        const grant = codes.get(code);
        codes.delete(code);
        const challenge = createHash('sha256')
          .update(form.get('code_verifier') ?? '')
          .digest('base64url');
        if (
          !grant ||
          grant.challenge !== challenge ||
          grant.redirectUri !== form.get('redirect_uri')
        ) {
          sendJson(res, 400, { error: 'invalid_grant' });
          return;
        }
        const { profile } = grant;
        const idToken = await new SignJWT({
          ...profile,
          email_verified: profile.email ? true : undefined,
          nonce: grant.nonce,
        })
          .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
          .setIssuer(issuer)
          .setAudience(CLIENT_ID)
          .setSubject(profile.sub)
          .setIssuedAt()
          .setExpirationTime('5m')
          .sign(privateKey);
        sendJson(res, 200, {
          access_token: `at-${profile.sub}`,
          token_type: 'Bearer',
          expires_in: 300,
          id_token: idToken,
        });
      } else if (url.pathname === '/oidc/me') {
        const sub = String(req.headers.authorization).replace('Bearer at-', '');
        const profile = sub === fake.profile.sub ? fake.profile : null;
        sendJson(res, 200, profile ? { ...profile, email_verified: Boolean(profile.email) } : {});
      } else if (url.pathname === '/oidc/reg' && req.method === 'POST') {
        const body = JSON.parse(await readBody(req)) as Record<string, unknown>;
        fake.registrations.push({ body, authorization: req.headers.authorization });
        if (req.headers.authorization !== `Bearer ${SETUP_TOKEN}`) {
          sendJson(res, 401, {
            error: 'invalid_token',
            error_description: 'invalid token provided',
          });
        } else if (fake.registerAnswer === 'rateLimited') {
          sendJson(res, 429, { error: 'too_many_requests' });
        } else if (fake.registerAnswer === 'badRedirect') {
          sendJson(res, 400, {
            error: 'invalid_redirect_uri',
            error_description: 'redirect_uris must use https',
          });
        } else {
          sendJson(res, 201, {
            ...body,
            client_id: CLIENT_ID,
            client_secret: CLIENT_SECRET,
            registration_access_token: RAT,
            registration_client_uri: `${issuer}/reg/${CLIENT_ID}`,
          });
        }
      } else if (url.pathname === `/oidc/reg/${CLIENT_ID}` && req.method === 'DELETE') {
        fake.deletions.push(req.headers.authorization);
        res.writeHead(fake.deleteStatus);
        res.end();
      } else {
        sendJson(res, 404, { error: 'not_found' });
      }
    })();
  });

  const issuer = `${origin}/oidc`;
  fake = {
    issuer,
    claimedIssuer: issuer,
    profile: { sub: 'u1', email: 'ada@example.com', name: 'Ada' },
    canRegister: true,
    registerAnswer: 'created',
    registrations: [],
    deletions: [],
    deleteStatus: 204,
    authorize(authorizeUrl) {
      const params = new URL(authorizeUrl).searchParams;
      expect(params.get('client_id')).toBe(CLIENT_ID);
      expect(params.get('scope')?.split(' ')).toEqual(
        expect.arrayContaining(['openid', 'email', 'profile']),
      );
      expect(params.get('code_challenge_method')).toBe('S256');
      const code = randomUUID();
      codes.set(code, {
        nonce: params.get('nonce') ?? '',
        challenge: params.get('code_challenge') ?? '',
        redirectUri: params.get('redirect_uri') ?? '',
        profile: fake.profile,
      });
      return { code, state: params.get('state') ?? '' };
    },
    close: () => close(server),
  };
  return fake;
}

type GraphQLResult = {
  data?: Record<string, any> | null;
  errors?: { message: string; extensions?: Record<string, unknown> }[];
};

let db: Awaited<ReturnType<typeof createMigratedTestDb>>;
let provider: FakeProvider;
let host: AuthHost;
let eunomia: Server;
let origin: string;
let handler: RequestListener = (_req, res) => res.end();

/** (Re)builds eunomia's host and routes, as index.ts does, with the registration policy given. */
async function boot(policy: { allowedEmails?: string[]; disableSignUp?: boolean } = {}) {
  host = await createAuthHost(db as never, { secret: SECRET, ...policy });
  const gateway = createAuthGateway(host, db as never);
  const yoga = createApp(db as never, host, gateway);
  const sso = createSsoHandler(host, { allowedEmails: policy.allowedEmails });
  handler = (req, res) => {
    if (sso(req, res)) return;
    void yoga(req, res);
  };
}

beforeEach(async () => {
  db = await createMigratedTestDb();
  provider = await startProvider();
  ({ server: eunomia, origin } = await listen((req, res) => handler(req, res)));
  // One origin for both, as the container serves the dashboard itself.
  vi.stubEnv('BETTER_AUTH_URL', origin);
  vi.stubEnv('APP_URL', '');
  vi.stubEnv('OIDC_ISSUER', '');
  vi.stubEnv('OIDC_CLIENT_ID', '');
  // Logged refusals are expected here; keep them out of the run's output.
  vi.spyOn(console, 'error').mockImplementation(() => {});
  await boot();
});

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  await close(eunomia);
  await provider.close();
});

async function gql(
  query: string,
  variables: Record<string, unknown> = {},
  token?: string,
): Promise<GraphQLResult> {
  const response = await fetch(`${origin}/graphql`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ query, variables }),
  });
  return (await response.json()) as GraphQLResult;
}

async function ok(query: string, variables?: Record<string, unknown>, token?: string) {
  const result = await gql(query, variables, token);
  expect(result.errors).toBeUndefined();
  return result.data!;
}

async function failure(query: string, variables?: Record<string, unknown>, token?: string) {
  const result = await gql(query, variables, token);
  expect(result.errors).toHaveLength(1);
  const [error] = result.errors!;
  return { message: error!.message, ...error!.extensions };
}

const setupUrl = (token = SETUP_TOKEN, name = 'heautou') =>
  `${provider.issuer}#setup=${encodeURIComponent(token)}&name=${encodeURIComponent(name)}`;

/** A user row and a bearer session for it, without going through any sign-in. */
async function makeUser(email: string, admin = false): Promise<{ id: string; token: string }> {
  const id = randomUUID();
  await db.insert(user).values({ id, name: email.split('@')[0]!, email, isAdmin: admin });
  const ctx = await host.current().$context;
  const session = await ctx.internalAdapter.createSession(id);
  return { id, token: session.token };
}

function cookiesFrom(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(';')[0])
    .join('; ');
}

/** Walks the browser through a sign-in: the start route, the provider, the callback. */
async function signIn(
  tamper?: (callback: URL) => void,
  startQuery = '',
): Promise<{ location: URL; callback: Response }> {
  const start = await fetch(`${origin}${SSO_START_PATH}${startQuery}`, { redirect: 'manual' });
  expect(start.status).toBe(302);
  const authorizeUrl = start.headers.get('location') ?? '';
  expect(authorizeUrl.startsWith(`${provider.issuer}/auth?`)).toBe(true);
  expect(new URL(authorizeUrl).searchParams.get('redirect_uri')).toBe(
    `${origin}${SSO_CALLBACK_PATH}`,
  );

  const { code, state } = provider.authorize(authorizeUrl);
  const back = new URL(`${origin}${SSO_CALLBACK_PATH}`);
  back.searchParams.set('code', code);
  back.searchParams.set('state', state);
  back.searchParams.set('iss', provider.issuer);
  tamper?.(back);
  const callback = await fetch(back, {
    redirect: 'manual',
    headers: { cookie: cookiesFrom(start) },
  });
  expect(callback.status).toBe(302);
  return { location: new URL(callback.headers.get('location') ?? ''), callback };
}

async function pairAnonymously() {
  await ok(PAIR, { url: setupUrl() });
}

describe('setup URLs', () => {
  it('takes the issuer, token and name apart', () => {
    expect(parseSetupUrl('https://id.example.com/oidc#setup=abc&name=heautou')).toEqual({
      issuer: 'https://id.example.com/oidc',
      token: 'abc',
      name: 'heautou',
    });
    expect(parseSetupUrl('https://id.example.com/oidc/#setup=abc').name).toBe('SSO');
  });

  it('refuses anything that is not a setup URL', () => {
    expect(() => parseSetupUrl('not a url')).toThrow(/not a URL/);
    expect(() => parseSetupUrl('https://id.example.com/oidc')).toThrow(/no setup token/);
    expect(() => parseSetupUrl('ftp://id.example.com/oidc#setup=abc')).toThrow(/https/);
  });
});

describe('OIDC environment', () => {
  it('refuses half a setup, a bad issuer and an unknown client auth', () => {
    expect(oidcEnvProblem({ OIDC_ISSUER: 'https://id.example.com' })).toMatch(/go together/);
    expect(oidcEnvProblem({ OIDC_CLIENT_ID: 'x' })).toMatch(/go together/);
    expect(oidcEnvProblem({ OIDC_ISSUER: 'nope', OIDC_CLIENT_ID: 'x' })).toMatch(/not a URL/);
    expect(
      oidcEnvProblem({
        OIDC_ISSUER: 'https://id.example.com',
        OIDC_CLIENT_ID: 'x',
        OIDC_CLIENT_AUTH: 'private_key_jwt',
      }),
    ).toMatch(/OIDC_CLIENT_AUTH/);
    expect(oidcEnvProblem({})).toBeNull();
  });
});

describe('pairSso', () => {
  it('registers eunomia and offers the provider without a restart', async () => {
    expect((await ok(SETUP)).ssoSetup).toMatchObject({
      source: 'NONE',
      signInUrl: null,
      canPair: true,
      redirectUri: `${origin}${SSO_CALLBACK_PATH}`,
    });

    const data = await ok(PAIR, { url: setupUrl() });
    expect(data.pairSso).toEqual({ source: 'PAIRED', name: 'heautou', canPair: true });

    expect(provider.registrations).toHaveLength(1);
    expect(provider.registrations[0]).toEqual({
      authorization: `Bearer ${SETUP_TOKEN}`,
      body: {
        client_name: 'eunomia',
        redirect_uris: [`${origin}${SSO_CALLBACK_PATH}`],
        token_endpoint_auth_method: 'client_secret_basic',
        grant_types: ['authorization_code'],
        response_types: ['code'],
      },
    });
    expect(await readPairedOidc(db as never)).toMatchObject({
      issuer: provider.issuer,
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      registrationAccessToken: RAT,
    });
    expect((await ok(SETUP)).ssoSetup).toMatchObject({
      source: 'PAIRED',
      name: 'heautou',
      signInUrl: `${origin}${SSO_START_PATH}`,
    });
  });

  it('says a used or expired setup URL is spent, and keeps nothing', async () => {
    const error = await failure(PAIR, { url: setupUrl('iat-used') });
    expect(error).toMatchObject({ code: 'BAD_USER_INPUT', reason: PairingFailure.Expired });
    expect(await readPairedOidc(db as never)).toBeNull();
    expect(host.oidc()).toBeNull();
  });

  it('passes on why the provider refused, and when it is rate limiting', async () => {
    provider.registerAnswer = 'badRedirect';
    const refused = await failure(PAIR, { url: setupUrl() });
    expect(refused).toMatchObject({ code: 'BAD_USER_INPUT', reason: PairingFailure.Refused });
    expect(refused.message).toMatch(/redirect_uris must use https/);

    provider.registerAnswer = 'rateLimited';
    expect(await failure(PAIR, { url: setupUrl() })).toMatchObject({
      code: 'RATE_LIMITED',
      reason: PairingFailure.RateLimited,
    });
  });

  it('refuses a discovery document naming another issuer, before sending the token', async () => {
    provider.claimedIssuer = 'https://evil.example.com/oidc';
    expect(await failure(PAIR, { url: setupUrl() })).toMatchObject({
      reason: PairingFailure.NotAProvider,
    });
    expect(provider.registrations).toHaveLength(0);
  });

  it('says when the provider cannot pair, and will not pair twice', async () => {
    provider.canRegister = false;
    expect(await failure(PAIR, { url: setupUrl() })).toMatchObject({
      reason: PairingFailure.NoRegistration,
    });
    provider.canRegister = true;
    await pairAnonymously();
    expect(await failure(PAIR, { url: setupUrl() })).toMatchObject({ code: 'CONFLICT' });
  });
});

describe('who may pair', () => {
  it('is only the admin, by session, once anyone has an account', async () => {
    const admin = await makeUser('admin@example.com', true);
    const member = await makeUser('member@example.com');

    expect((await ok(SETUP)).ssoSetup).toMatchObject({ canPair: false, issuer: null });
    expect((await ok(SETUP, {}, member.token)).ssoSetup.canPair).toBe(false);
    expect((await ok(SETUP, {}, admin.token)).ssoSetup.canPair).toBe(true);

    expect(await failure(PAIR, { url: setupUrl() })).toMatchObject({ code: 'FORBIDDEN' });
    expect(await failure(PAIR, { url: setupUrl() }, member.token)).toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(provider.registrations).toHaveLength(0);

    await ok(PAIR, { url: setupUrl() }, admin.token);
    expect((await ok(SETUP, {}, admin.token)).ssoSetup.issuer).toBe(provider.issuer);
    expect(await failure(UNPAIR, {}, member.token)).toMatchObject({ code: 'FORBIDDEN' });
  });

  it('is nobody when the environment names the provider, which wins', async () => {
    vi.stubEnv('OIDC_ISSUER', provider.issuer);
    vi.stubEnv('OIDC_CLIENT_ID', CLIENT_ID);
    vi.stubEnv('OIDC_NAME', 'Corp SSO');
    const admin = await makeUser('admin@example.com', true);
    expect((await ok(SETUP, {}, admin.token)).ssoSetup).toMatchObject({
      source: 'ENV',
      name: 'Corp SSO',
      canPair: false,
    });
    expect(await failure(PAIR, { url: setupUrl() }, admin.token)).toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('makes the first account the admin, and hands it on when that account goes', async () => {
    const internal = (await host.current().$context).internalAdapter;
    const source = { method: 'test' };
    const first = await internal.createUser(
      { email: 'first@example.com', name: 'first', emailVerified: true },
      source,
    );
    const second = await internal.createUser(
      { email: 'second@example.com', name: 'second', emailVerified: true },
      source,
    );
    expect(await isAdmin(db as never, first.id)).toBe(true);
    expect(await isAdmin(db as never, second.id)).toBe(false);

    await deleteAccount(db as never, first.id, 'first@example.com');
    expect(await isAdmin(db as never, second.id)).toBe(true);
  });
});

describe('OIDC sign-in', () => {
  beforeEach(pairAnonymously);

  it('lands on the dashboard with a one-time token it swaps for a session', async () => {
    const { location, callback } = await signIn();
    expect(location.origin + location.pathname).toBe(`${origin}/`);
    // The session reaches the dashboard as a bearer token, never as a cookie.
    expect(callback.headers.getSetCookie().some((c) => c.includes('session_token'))).toBe(false);

    const token = location.searchParams.get('sso') ?? '';
    const session = (await ok(VERIFY, { token })).verifyOneTimeToken;
    const me = (await ok('{ me { email isAdmin } }', {}, session.token)).me;
    // The instance's first account, so its admin.
    expect(me).toEqual({ email: 'ada@example.com', isAdmin: true });

    // Spent, and a spent token is bad input, not a signed-out session.
    expect(await failure(VERIFY, { token })).toMatchObject({ code: 'BAD_USER_INPUT' });
  });

  it('signs an existing account in by the address the provider vouches for', async () => {
    const existing = await makeUser('ada@example.com');
    const { location } = await signIn();
    const session = (await ok(VERIFY, { token: location.searchParams.get('sso') }))
      .verifyOneTimeToken;
    expect(session.userId).toBe(existing.id);
  });

  it('names a new account from the username when there is no name', async () => {
    provider.profile = { sub: 'u2', email: 'bob@example.com', preferred_username: 'bob' };
    const { location } = await signIn();
    const session = (await ok(VERIFY, { token: location.searchParams.get('sso') }))
      .verifyOneTimeToken;
    const [row] = await db
      .select({ name: user.name })
      .from(user)
      .where(eq(user.id, session.userId));
    expect(row?.name).toBe('bob');
  });

  it('refuses a callback whose state does not match', async () => {
    const { location } = await signIn((back) => back.searchParams.set('state', 'forged'));
    expect(location.searchParams.get('error')).toBeTruthy();
    expect(location.searchParams.get('sso')).toBeNull();
  });

  it('stops offering the provider once it is disconnected', async () => {
    const { location } = await signIn();
    const session = (await ok(VERIFY, { token: location.searchParams.get('sso') }))
      .verifyOneTimeToken;

    expect((await ok(UNPAIR, {}, session.token)).unpairSso).toEqual({
      source: 'NONE',
      name: null,
      signInUrl: null,
    });
    expect(provider.deletions).toEqual([`Bearer ${RAT}`]);
    expect(await readPairedOidc(db as never)).toBeNull();

    const start = await fetch(`${origin}${SSO_START_PATH}`, { redirect: 'manual' });
    expect(new URL(start.headers.get('location') ?? '').searchParams.get('error')).toBe('sso_off');
  });

  it('forgets the pairing even when the provider will not delete the client', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const admin = await makeUser('admin@example.com', true);
    provider.deleteStatus = 500;
    await ok(UNPAIR, {}, admin.token);
    expect(await readPairedOidc(db as never)).toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('[auth]'));
  });
});

describe('OIDC sign-in under a registration policy', () => {
  beforeEach(pairAnonymously);

  it('refuses an existing account ALLOWED_EMAILS no longer covers', async () => {
    await makeUser('ada@example.com');
    await boot({ allowedEmails: ['*@work.test'] });
    const { location } = await signIn();
    expect(location.searchParams.get('error')).toBe('not_allowed');
    expect(location.searchParams.get('sso')).toBeNull();
  });

  it('creates no account for an address ALLOWED_EMAILS does not cover', async () => {
    await boot({ allowedEmails: ['*@work.test'] });
    const { location } = await signIn();
    expect(location.searchParams.get('error')).toBeTruthy();
    expect(location.searchParams.get('sso')).toBeNull();
    expect(await db.select().from(user)).toHaveLength(0);
  });

  it('creates no account under DISABLE_SIGNUP, but signs an existing one in', async () => {
    await boot({ disableSignUp: true });
    const refused = await signIn();
    expect(refused.location.searchParams.get('sso')).toBeNull();
    expect(await db.select().from(user)).toHaveLength(0);

    await makeUser('ada@example.com');
    const { location } = await signIn();
    expect(location.searchParams.get('sso')).toBeTruthy();
  });
});

describe('agent sign-in', () => {
  beforeEach(pairAnonymously);

  const VERIFIER = 'a-verifier-only-the-agent-knows-0123456789';
  const VERIFY_AGENT =
    'mutation ($token: String!, $verifier: String) { verifyOneTimeToken(token: $token, codeVerifier: $verifier) { token userId } }';
  const agentQuery = (returnTo: string, verifier = VERIFIER) =>
    `?return_to=${encodeURIComponent(returnTo)}&code_challenge=${s256(verifier)}`;

  it('hands the token to the app, usable only with the verifier behind the challenge', async () => {
    const { location } = await signIn(undefined, agentQuery('eunomia://sso'));
    expect(`${location.protocol}//${location.host}${location.pathname}`).toBe('eunomia://sso');
    const token = location.searchParams.get('sso') ?? '';

    // Something that intercepted the redirect has the token but not the verifier.
    expect(await failure(VERIFY_AGENT, { token })).toMatchObject({ code: 'BAD_USER_INPUT' });
    expect(await failure(VERIFY_AGENT, { token, verifier: 'wrong' })).toMatchObject({
      code: 'BAD_USER_INPUT',
    });
    // And trying didn't spend it: the agent that asked still signs in.
    const session = (await ok(VERIFY_AGENT, { token, verifier: VERIFIER })).verifyOneTimeToken;
    expect((await ok('{ me { email } }', {}, session.token)).me.email).toBe('ada@example.com');
  });

  it('hands it to a loopback port, as the desktop agent listens on', async () => {
    const { location } = await signIn(undefined, agentQuery('http://127.0.0.1:53682/sso'));
    expect(location.origin).toBe('http://127.0.0.1:53682');
    expect(location.searchParams.get('sso')).toBeTruthy();
  });

  it('sends a refusal back to the app too', async () => {
    const { location } = await signIn(
      (back) => back.searchParams.set('state', 'forged'),
      agentQuery('eunomia://sso'),
    );
    expect(location.protocol).toBe('eunomia:');
    expect(location.searchParams.get('error')).toBeTruthy();
    expect(location.searchParams.get('sso')).toBeNull();
  });

  it('refuses any other target, or one without a challenge', async () => {
    for (const query of [
      agentQuery('https://evil.example.com/steal'),
      agentQuery('http://192.168.1.5:8080/sso'),
      `?return_to=${encodeURIComponent('eunomia://sso')}`,
    ]) {
      const start = await fetch(`${origin}${SSO_START_PATH}${query}`, { redirect: 'manual' });
      expect(start.status).toBe(400);
    }
  });

  it("does not let an abandoned agent sign-in capture the dashboard's next one", async () => {
    // Started for the app, never finished...
    const abandoned = await fetch(`${origin}${SSO_START_PATH}${agentQuery('eunomia://sso')}`, {
      redirect: 'manual',
    });
    // ...then a plain dashboard sign-in in the same browser.
    const start = await fetch(`${origin}${SSO_START_PATH}`, {
      redirect: 'manual',
      headers: { cookie: cookiesFrom(abandoned) },
    });
    expect(
      start.headers.getSetCookie().some((c) => /eunomia_sso_return=;.*Max-Age=0/.test(c)),
    ).toBe(true);
  });

  it('refuses a token this server never minted, verifier or not', async () => {
    expect(await failure(VERIFY_AGENT, { token: 'made-up', verifier: VERIFIER })).toMatchObject({
      code: 'BAD_USER_INPUT',
    });
  });

  it('provisions a device end to end, the way the agents do', async () => {
    // What the setup screen asks the server it was pointed at.
    const provider = await fetchSsoProvider(origin);
    expect(provider).toEqual({ name: 'heautou', signInUrl: `${origin}${SSO_START_PATH}` });

    // What the shell does: open the start URL with its return target and
    // challenge, then read the token off wherever the browser came back to.
    const startUrl = new URL(ssoStartUrl(provider!.signInUrl, 'eunomia://sso', s256(VERIFIER)));
    const { location } = await signIn(undefined, startUrl.search);
    const token = ssoTokenFrom(location.toString());

    const device = await provisionDevice({
      serverUrl: origin,
      sso: { token, codeVerifier: VERIFIER },
      name: 'phone',
      platform: 'android',
    });
    expect(device.reKeyed).toBe(false);
    // The device key works.
    const me = await fetch(`${origin}/graphql`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': device.apiKey },
      body: JSON.stringify({ query: '{ me { email } }' }),
    });
    expect(((await me.json()) as GraphQLResult).data?.me.email).toBe('ada@example.com');
  });
});
