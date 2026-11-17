import { createHash, randomUUID } from 'node:crypto';
import {
  createServer,
  type IncomingMessage,
  type RequestListener,
  type Server,
  type ServerResponse,
} from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  createTokenSource,
  DEVICE_CODE_GRANT,
  discoverProvider,
  fetchDeviceSignIn,
  pollDeviceToken,
  provisionDevice,
  startDeviceAuthorization,
  uploadBatch,
} from '@eunomia/agent';
import { eq } from 'drizzle-orm';
import { exportJWK, generateKeyPair, type JWTPayload, SignJWT } from 'jose';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deleteAccount } from '../src/activity/deletion.ts';
import { createApp } from '../src/app.ts';
import { createAuthGateway } from '../src/auth.ts';
import { type AuthHost, createAuthHost } from '../src/auth-host.ts';
import { user } from '../src/db/schema.ts';
import { oidcEnvProblem, SSO_CALLBACK_PATH, SSO_START_PATH } from '../src/oidc/config.ts';
import { forgetDeviceClientCheck } from '../src/oidc/device-client.ts';
import { createSsoHandler } from '../src/oidc/http.ts';
import { PairingFailure, parseSetupUrl } from '../src/oidc/pairing.ts';
import {
  createProtectedResourceHandler,
  PROTECTED_RESOURCE_PATH,
} from '../src/oidc/protected-resource.ts';
import { isAdmin, readPairedOidc } from '../src/oidc/settings.ts';
import { createMigratedTestDb } from './helpers/test-db.ts';

// OIDC sign-in and pairing through the real HTTP surface, against a stand-in
// for heautou (oidc-provider): discovery, a JWKS, a code flow with the client
// secret in a Basic header, PKCE, a signed id token carrying the nonce —
// Dynamic Client Registration (RFC 7591) with reading and deletion (RFC 7592),
// and the device flow (RFC 8628) issuing JWT access tokens for eunomia's API
// (RFC 9068) to the device client pairing registered beside eunomia's own.

const SECRET = 'test-secret-test-secret-test-secret';
const SETUP_TOKEN = 'iat-good';
const CLIENT_ID = 'eunomia-client';
const CLIENT_SECRET = 'eunomia-secret';
const RAT = 'rat-1';
const DEVICE_CLIENT_ID = 'eunomia-device';
const DEVICE_RAT = 'rat-device';

const SETUP = '{ ssoSetup { source name signInUrl issuer canPair redirectUri } }';
const DEVICE_SETUP = '{ ssoSetup { deviceClientId } }';
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
  /** Whether discovery offers the device flow, so pairing registers a device client. */
  deviceFlow: boolean;
  /** Whether the provider's admin has turned the device client's device flow on. */
  deviceGrantOn: boolean;
  /** Plays the browser at the authorize endpoint: the code and state it would be sent back with. */
  authorize(url: string): { code: string; state: string };
  /** Plays the person approving a device code at the provider. */
  approve(userCode: string): void;
  /** An access token for eunomia's API, signed by this provider unless the header says otherwise. */
  accessToken(claims?: JWTPayload, header?: { alg?: string; typ?: string }): Promise<string>;
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
  /** Device codes waiting for approval, by user code. */
  const devices = new Map<
    string,
    { deviceCode: string; resource: string; approved: boolean; profile: Profile }
  >();
  const refreshes = new Map<string, { resource: string; profile: Profile }>();
  let fake!: FakeProvider;

  /** An RFC 9068 access token for `audience`, as heautou issues for an API. */
  const signAccessToken = (profile: Profile, audience: string) =>
    new SignJWT({ client_id: DEVICE_CLIENT_ID })
      .setProtectedHeader({ alg: 'RS256', kid: 'k1', typ: 'at+jwt' })
      .setJti(randomUUID())
      .setIssuer(fake.issuer)
      .setAudience(audience)
      .setSubject(profile.sub)
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(privateKey);

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
          ...(fake.deviceFlow
            ? {
                device_authorization_endpoint: `${issuer}/device/auth`,
                grant_types_supported: ['authorization_code', 'refresh_token', DEVICE_CODE_GRANT],
              }
            : {}),
          id_token_signing_alg_values_supported: ['RS256'],
          token_endpoint_auth_methods_supported: ['client_secret_basic'],
        });
      } else if (url.pathname === '/oidc/jwks') {
        sendJson(res, 200, { keys: [jwk] });
      } else if (url.pathname === '/oidc/device/auth' && req.method === 'POST') {
        const form = new URLSearchParams(await readBody(req));
        if (form.get('client_id') !== DEVICE_CLIENT_ID || !fake.deviceGrantOn) {
          sendJson(res, 400, { error: 'unauthorized_client' });
          return;
        }
        const userCode = `CODE-${devices.size + 1}`;
        const deviceCode = randomUUID();
        devices.set(userCode, {
          deviceCode,
          resource: form.get('resource') ?? '',
          approved: false,
          profile: fake.profile,
        });
        sendJson(res, 200, {
          device_code: deviceCode,
          user_code: userCode,
          verification_uri: `${issuer}/device`,
          verification_uri_complete: `${issuer}/device?user_code=${userCode}`,
          expires_in: 600,
          interval: 5,
        });
      } else if (url.pathname === '/oidc/token' && req.method === 'POST') {
        const form = new URLSearchParams(await readBody(req));
        if (form.get('grant_type') === DEVICE_CODE_GRANT) {
          const waiting = [...devices.values()].find(
            (device) => device.deviceCode === form.get('device_code'),
          );
          if (!waiting || form.get('client_id') !== DEVICE_CLIENT_ID) {
            sendJson(res, 400, { error: 'invalid_grant' });
          } else if (!waiting.approved) {
            sendJson(res, 400, { error: 'authorization_pending' });
          } else {
            const refreshToken = randomUUID();
            refreshes.set(refreshToken, waiting);
            sendJson(res, 200, {
              access_token: await signAccessToken(waiting.profile, waiting.resource),
              token_type: 'Bearer',
              expires_in: 300,
              refresh_token: refreshToken,
            });
          }
          return;
        }
        if (form.get('grant_type') === 'refresh_token') {
          const grant = refreshes.get(form.get('refresh_token') ?? '');
          if (!grant || form.get('client_id') !== DEVICE_CLIENT_ID) {
            sendJson(res, 400, { error: 'invalid_grant' });
            return;
          }
          sendJson(res, 200, {
            access_token: await signAccessToken(
              grant.profile,
              form.get('resource') ?? grant.resource,
            ),
            token_type: 'Bearer',
            expires_in: 300,
          });
          return;
        }
        const basic = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');
        if (req.headers.authorization !== `Basic ${basic}`) {
          sendJson(res, 401, { error: 'invalid_client' });
          return;
        }
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
        } else if (body.token_endpoint_auth_method === 'none') {
          // The device client: public, and held back until the admin turns its
          // device flow on, as heautou does.
          sendJson(res, 201, {
            ...body,
            grant_types: ['refresh_token'],
            client_id: DEVICE_CLIENT_ID,
            registration_access_token: DEVICE_RAT,
            registration_client_uri: `${issuer}/reg/${DEVICE_CLIENT_ID}`,
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
      } else if (url.pathname === `/oidc/reg/${DEVICE_CLIENT_ID}` && req.method === 'GET') {
        if (req.headers.authorization !== `Bearer ${DEVICE_RAT}`) {
          sendJson(res, 401, { error: 'invalid_token' });
          return;
        }
        sendJson(res, 200, {
          client_id: DEVICE_CLIENT_ID,
          grant_types: fake.deviceGrantOn
            ? [DEVICE_CODE_GRANT, 'refresh_token']
            : ['refresh_token'],
        });
      } else if (
        (url.pathname === `/oidc/reg/${CLIENT_ID}` ||
          url.pathname === `/oidc/reg/${DEVICE_CLIENT_ID}`) &&
        req.method === 'DELETE'
      ) {
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
    deviceFlow: false,
    deviceGrantOn: false,
    approve(userCode) {
      const device = devices.get(userCode);
      if (!device) throw new Error(`no device is waiting with ${userCode}`);
      device.approved = true;
    },
    async accessToken(claims = {}, header = {}) {
      const alg = header.alg ?? 'RS256';
      const jwt = new SignJWT({ client_id: DEVICE_CLIENT_ID, ...claims })
        .setProtectedHeader({ alg, kid: 'k1', typ: header.typ ?? 'at+jwt' })
        .setIssuer(typeof claims.iss === 'string' ? claims.iss : fake.issuer)
        .setAudience(claims.aud ?? `${process.env.BETTER_AUTH_URL}/graphql`)
        .setSubject(claims.sub ?? fake.profile.sub)
        .setIssuedAt()
        .setExpirationTime(claims.exp ?? '5m');
      return alg === 'HS256'
        ? jwt.sign(new TextEncoder().encode('a-shared-secret-eunomia-never-holds'))
        : jwt.sign(privateKey);
    },
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
  const protectedResource = createProtectedResourceHandler(host);
  handler = (req, res) => {
    if (sso(req, res)) return;
    if (protectedResource(req, res)) return;
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
  vi.stubEnv('OIDC_DEVICE_CLIENT_ID', '');
  vi.stubEnv('OIDC_API_AUDIENCE', '');
  forgetDeviceClientCheck();
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
        client_uri: origin,
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

/** Signs the provider's current person in once in a browser, so eunomia has their account row. */
async function linkAccount(): Promise<{ token: string; userId: string }> {
  const { location } = await signIn();
  return (await ok(VERIFY, { token: location.searchParams.get('sso') })).verifyOneTimeToken;
}

/** `me` and the challenge header, for a bearer. */
async function asBearer(token: string) {
  const response = await fetch(`${origin}/graphql`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ query: '{ me { email } }' }),
  });
  const body = (await response.json()) as GraphQLResult;
  return { me: body.data?.me ?? null, challenge: response.headers.get('www-authenticate') };
}

describe('the device client', () => {
  it('is registered beside eunomia when the provider offers the device flow', async () => {
    provider.deviceFlow = true;
    await pairAnonymously();

    expect(provider.registrations).toHaveLength(2);
    expect(provider.registrations[1]).toEqual({
      authorization: `Bearer ${SETUP_TOKEN}`,
      body: {
        client_name: 'eunomia agents',
        client_uri: origin,
        redirect_uris: [],
        token_endpoint_auth_method: 'none',
        grant_types: [DEVICE_CODE_GRANT, 'refresh_token'],
        response_types: [],
      },
    });
    expect(await readPairedOidc(db as never)).toMatchObject({
      clientId: CLIENT_ID,
      deviceClientId: DEVICE_CLIENT_ID,
      deviceRegistrationAccessToken: DEVICE_RAT,
      deviceRegistrationClientUri: `${provider.issuer}/reg/${DEVICE_CLIENT_ID}`,
    });
  });

  it('is offered to agents only once the provider turns its device flow on', async () => {
    provider.deviceFlow = true;
    await pairAnonymously();
    expect((await ok(DEVICE_SETUP)).ssoSetup.deviceClientId).toBeNull();

    provider.deviceGrantOn = true;
    forgetDeviceClientCheck();
    expect((await ok(DEVICE_SETUP)).ssoSetup.deviceClientId).toBe(DEVICE_CLIENT_ID);
  });

  it('is not registered when the provider has no device flow', async () => {
    await pairAnonymously();
    expect(provider.registrations).toHaveLength(1);
    expect((await readPairedOidc(db as never))?.deviceClientId).toBeNull();
    expect((await ok(DEVICE_SETUP)).ssoSetup.deviceClientId).toBeNull();
  });

  it("is deleted with eunomia's own client on unpairing", async () => {
    provider.deviceFlow = true;
    await pairAnonymously();
    const admin = await linkAccount();
    await ok(UNPAIR, {}, admin.token);
    expect(provider.deletions).toEqual([`Bearer ${RAT}`, `Bearer ${DEVICE_RAT}`]);
  });

  it('is OIDC_DEVICE_CLIENT_ID when the environment names the provider', async () => {
    vi.stubEnv('OIDC_ISSUER', provider.issuer);
    vi.stubEnv('OIDC_CLIENT_ID', CLIENT_ID);
    expect((await ok(DEVICE_SETUP)).ssoSetup.deviceClientId).toBeNull();
    vi.stubEnv('OIDC_DEVICE_CLIENT_ID', 'agents-by-hand');
    expect((await ok(DEVICE_SETUP)).ssoSetup.deviceClientId).toBe('agents-by-hand');
  });
});

describe('protected resource metadata', () => {
  const metadata = async (path = PROTECTED_RESOURCE_PATH) => {
    const response = await fetch(`${origin}${path}`);
    expect(response.status).toBe(200);
    return response.json();
  };

  it('names no authorization server without a provider', async () => {
    expect(await metadata()).toEqual({
      resource: `${origin}/graphql`,
      authorization_servers: [],
      bearer_methods_supported: ['header'],
      resource_name: 'eunomia',
    });
  });

  it('names the paired provider, at the well-known path and under the resource path', async () => {
    await pairAnonymously();
    for (const path of [PROTECTED_RESOURCE_PATH, `${PROTECTED_RESOURCE_PATH}/graphql`]) {
      expect(await metadata(path)).toMatchObject({
        resource: `${origin}/graphql`,
        authorization_servers: [provider.issuer],
      });
    }
  });
});

describe('provider access tokens', () => {
  beforeEach(pairAnonymously);

  it('sign in as the account that signed in through the provider', async () => {
    await linkAccount();
    expect(await asBearer(await provider.accessToken())).toEqual({
      me: { email: 'ada@example.com' },
      challenge: null,
    });
  });

  it('are nobody when anything about them is off, and say where to get a good one', async () => {
    await linkAccount();
    const refused = [
      await provider.accessToken({ aud: 'https://another.example.com/graphql' }),
      await provider.accessToken({ iss: 'https://evil.example.com/oidc' }),
      await provider.accessToken({}, { typ: 'JWT' }),
      await provider.accessToken({}, { alg: 'HS256' }),
      await provider.accessToken({ exp: Math.floor(Date.now() / 1000) - 600 }),
      // Someone the provider knows who never signed in to eunomia.
      await provider.accessToken({ sub: 'never-signed-in' }),
    ];
    for (const token of refused) {
      const { me, challenge } = await asBearer(token);
      expect(me).toBeNull();
      expect(challenge).toBe(
        `Bearer error="invalid_token", resource_metadata="${origin}${PROTECTED_RESOURCE_PATH}"`,
      );
    }
  });

  it("may register a device and upload to it, but not what is a session's alone", async () => {
    await linkAccount();
    const token = await provider.accessToken();
    const { registerDevice } = await ok(
      'mutation { registerDevice(name: "laptop", platform: "linux") { id } }',
      {},
      token,
    );
    const pings = [{ capturedAt: '2026-08-12T09:00:00.000Z', app: 'code', idleSeconds: 0 }];
    await ok(
      'mutation ($id: String!, $pings: [PingInput!]!) { recordPings(deviceId: $id, pings: $pings) }',
      { id: registerDevice.id, pings },
      token,
    );

    for (const sessionOnly of [
      'mutation { createApiKey(name: "leak") { token } }',
      'mutation { deviceSignInLink }',
      '{ apiKeys { id } }',
    ]) {
      expect(await failure(sessionOnly, {}, token)).toMatchObject({ code: 'UNAUTHENTICATED' });
    }
  });

  it('are nobody once the provider is disconnected', async () => {
    const admin = await linkAccount();
    const token = await provider.accessToken();
    await ok(UNPAIR, {}, admin.token);
    expect(await asBearer(token)).toEqual({ me: null, challenge: null });
  });
});

describe('agent device sign-in', () => {
  beforeEach(async () => {
    provider.deviceFlow = true;
    provider.deviceGrantOn = true;
    await pairAnonymously();
  });

  /** What the setup screen does: find the provider, get a code, wait for the person to approve it. */
  const deviceSignIn = async () => {
    const signInWith = await fetchDeviceSignIn(origin);
    expect(signInWith).toEqual({
      providerName: 'heautou',
      issuer: provider.issuer,
      audience: `${origin}/graphql`,
      clientId: DEVICE_CLIENT_ID,
    });
    const endpoints = await discoverProvider(signInWith!.issuer);
    const code = await startDeviceAuthorization(
      endpoints,
      signInWith!.clientId,
      signInWith!.audience,
    );
    const tokens = await pollDeviceToken(endpoints, signInWith!.clientId, code, {
      // The person approves while the agent waits.
      sleep: async () => provider.approve(code.userCode),
    });
    return {
      kind: 'provider' as const,
      ...tokens,
      issuer: endpoints.issuer,
      clientId: signInWith!.clientId,
      audience: signInWith!.audience,
      tokenEndpoint: endpoints.tokenEndpoint,
    };
  };

  it('provisions a device and uploads to it, the way the agents do', async () => {
    await linkAccount();
    const credential = await deviceSignIn();

    const device = await provisionDevice({
      serverUrl: origin,
      credential,
      name: 'phone',
      platform: 'android',
    });
    expect(device.reconnected).toBe(false);

    const tokens = createTokenSource(credential);
    const ping = {
      capturedAt: '2026-08-12T09:00:00.000Z',
      app: 'code',
      title: null,
      context: null,
      idleSeconds: 0,
    };
    expect(
      await uploadBatch({ serverUrl: origin, deviceId: device.deviceId, tokens }, [ping]),
    ).toEqual({ accepted: true, error: null });
  });

  it('refreshes an access token that is about to expire, and keeps the new one', async () => {
    await linkAccount();
    const credential = { ...(await deviceSignIn()), expiresAt: Date.now() - 1000 };
    const saved: unknown[] = [];
    const tokens = createTokenSource(credential, { save: (next) => void saved.push(next) });

    const bearer = await tokens.bearer();
    expect(bearer).not.toBe(credential.accessToken);
    expect(saved).toHaveLength(1);
    expect((await asBearer(bearer)).me).toEqual({ email: 'ada@example.com' });
  });

  it('says to sign in to the dashboard once when eunomia has never seen the account', async () => {
    const credential = await deviceSignIn();
    await expect(
      provisionDevice({ serverUrl: origin, credential, name: 'phone', platform: 'android' }),
    ).rejects.toThrow(/Sign in to the eunomia dashboard with your provider once/);
  });

  it('is not offered while the provider holds the device flow back', async () => {
    provider.deviceGrantOn = false;
    forgetDeviceClientCheck();
    expect(await fetchDeviceSignIn(origin)).toBeNull();
  });
});
