import { describe, expect, it, vi } from 'vitest';
import {
  DEVICE_CODE_GRANT,
  DeviceFlowError,
  discoverProvider,
  fetchDeviceSignIn,
  pollDeviceToken,
  refreshTokens,
  startDeviceAuthorization,
} from './device-flow.ts';

// The device flow against a provider that is only a fetch: each test says what
// the provider answers and checks what was asked of it.

type Answer = { status?: number; body: unknown };

function provider(answers: Record<string, Answer | Answer[]>) {
  const asked: { url: string; method: string; form: Record<string, string> }[] = [];
  const queues = new Map(
    Object.entries(answers).map(([url, a]) => [url, Array.isArray(a) ? [...a] : [a]]),
  );
  const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const body = typeof init?.body === 'string' ? init.body : '';
    asked.push({
      url,
      method: init?.method ?? 'GET',
      form: Object.fromEntries(
        body
          .split('&')
          .filter(Boolean)
          .map((pair) => pair.split('=').map(decodeURIComponent) as [string, string]),
      ),
    });
    const queue = queues.get(url);
    const answer = queue && (queue.length > 1 ? queue.shift() : queue[0]);
    if (!answer) return new Response('{}', { status: 404 });
    return new Response(JSON.stringify(answer.body), { status: answer.status ?? 200 });
  }) as unknown as typeof fetch;
  return { fetch: fetchImpl, asked };
}

const ISSUER = 'https://id.example';
const endpoints = {
  issuer: ISSUER,
  deviceAuthorizationEndpoint: `${ISSUER}/device/auth`,
  tokenEndpoint: `${ISSUER}/token`,
};
const device = {
  deviceCode: 'dc',
  userCode: 'ABCD-EFGH',
  verificationUri: `${ISSUER}/device`,
  verificationUriComplete: null,
  expiresInSeconds: 600,
  intervalSeconds: 5,
};
const noSleep = async () => {};

describe('discoverProvider', () => {
  it('reads the endpoints from the issuer’s own document', async () => {
    const { fetch } = provider({
      [`${ISSUER}/.well-known/openid-configuration`]: {
        body: {
          issuer: `${ISSUER}/`,
          device_authorization_endpoint: endpoints.deviceAuthorizationEndpoint,
          token_endpoint: endpoints.tokenEndpoint,
        },
      },
    });
    expect(await discoverProvider(`${ISSUER}/`, fetch)).toEqual(endpoints);
  });

  it('refuses a document naming another issuer', async () => {
    const { fetch } = provider({
      [`${ISSUER}/.well-known/openid-configuration`]: {
        body: {
          issuer: 'https://evil.example',
          device_authorization_endpoint: 'x',
          token_endpoint: 'y',
        },
      },
    });
    await expect(discoverProvider(ISSUER, fetch)).rejects.toMatchObject({ code: 'not_a_provider' });
  });

  it('refuses a provider without the device flow', async () => {
    const { fetch } = provider({
      [`${ISSUER}/.well-known/openid-configuration`]: {
        body: { issuer: ISSUER, token_endpoint: 'y' },
      },
    });
    await expect(discoverProvider(ISSUER, fetch)).rejects.toMatchObject({ code: 'no_device_flow' });
  });
});

describe('startDeviceAuthorization', () => {
  it('asks for eunomia’s audience with offline access', async () => {
    const { fetch, asked } = provider({
      [endpoints.deviceAuthorizationEndpoint]: {
        body: {
          device_code: 'dc',
          user_code: 'ABCD-EFGH',
          verification_uri: `${ISSUER}/device`,
          verification_uri_complete: `${ISSUER}/device?user_code=ABCD-EFGH`,
          expires_in: 300,
          interval: 2,
        },
      },
    });
    const started = await startDeviceAuthorization(
      endpoints,
      'agents',
      'https://e.example/graphql',
      fetch,
    );
    expect(started).toMatchObject({
      userCode: 'ABCD-EFGH',
      expiresInSeconds: 300,
      intervalSeconds: 2,
    });
    expect(asked[0]?.form).toEqual({
      client_id: 'agents',
      scope: 'openid email offline_access',
      resource: 'https://e.example/graphql',
    });
  });

  it('says why the provider would not start', async () => {
    const { fetch } = provider({
      [endpoints.deviceAuthorizationEndpoint]: {
        status: 400,
        body: { error: 'invalid_target', error_description: 'not for this client' },
      },
    });
    await expect(startDeviceAuthorization(endpoints, 'agents', 'aud', fetch)).rejects.toThrow(
      /not for this client/,
    );
  });
});

describe('pollDeviceToken', () => {
  it('waits out pending and slow_down, then returns the tokens', async () => {
    const { fetch, asked } = provider({
      [endpoints.tokenEndpoint]: [
        { status: 400, body: { error: 'authorization_pending' } },
        { status: 400, body: { error: 'slow_down' } },
        { body: { access_token: 'a.b.c', refresh_token: 'r', expires_in: 300 } },
      ],
    });
    const sleeps: number[] = [];
    const tokens = await pollDeviceToken(endpoints, 'agents', device, {
      fetch,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      now: () => 1_000,
    });
    expect(tokens).toEqual({ accessToken: 'a.b.c', refreshToken: 'r', expiresAt: 301_000 });
    // slow_down adds five seconds to every poll after it.
    expect(sleeps).toEqual([5_000, 5_000, 10_000]);
    expect(asked[0]?.form).toEqual({
      grant_type: DEVICE_CODE_GRANT,
      device_code: 'dc',
      client_id: 'agents',
    });
  });

  it('stops when the person denies it', async () => {
    const { fetch } = provider({
      [endpoints.tokenEndpoint]: { status: 400, body: { error: 'access_denied' } },
    });
    await expect(
      pollDeviceToken(endpoints, 'agents', device, { fetch, sleep: noSleep }),
    ).rejects.toMatchObject({ code: 'access_denied' });
  });

  it('stops at the code’s expiry even if the provider keeps saying pending', async () => {
    const { fetch } = provider({
      [endpoints.tokenEndpoint]: { status: 400, body: { error: 'authorization_pending' } },
    });
    let clock = 0;
    const polling = pollDeviceToken(endpoints, 'agents', device, {
      fetch,
      sleep: async (ms) => {
        clock += ms;
      },
      now: () => clock,
    });
    await expect(polling).rejects.toMatchObject({ code: 'expired_token' });
  });

  it('stops when cancelled', async () => {
    const { fetch } = provider({});
    const abort = new AbortController();
    abort.abort();
    await expect(
      pollDeviceToken(endpoints, 'agents', device, { fetch, sleep: noSleep, signal: abort.signal }),
    ).rejects.toMatchObject({ code: 'cancelled' });
  });
});

describe('refreshTokens', () => {
  it('keeps the refresh token when the provider does not rotate it', async () => {
    const { fetch, asked } = provider({
      [endpoints.tokenEndpoint]: { body: { access_token: 'new', expires_in: 60 } },
    });
    const tokens = await refreshTokens(
      endpoints.tokenEndpoint,
      'agents',
      'r',
      'aud',
      fetch,
      () => 0,
    );
    expect(tokens).toEqual({ accessToken: 'new', refreshToken: 'r', expiresAt: 60_000 });
    expect(asked[0]?.form).toMatchObject({ grant_type: 'refresh_token', resource: 'aud' });
  });

  it('calls a refused refresh signed out, and a provider fault unreachable', async () => {
    const refused = provider({
      [endpoints.tokenEndpoint]: { status: 400, body: { error: 'invalid_grant' } },
    });
    await expect(
      refreshTokens(endpoints.tokenEndpoint, 'agents', 'r', 'aud', refused.fetch),
    ).rejects.toMatchObject({
      code: 'signed_out',
    });
    const down = provider({ [endpoints.tokenEndpoint]: { status: 503, body: {} } });
    await expect(
      refreshTokens(endpoints.tokenEndpoint, 'agents', 'r', 'aud', down.fetch),
    ).rejects.toBeInstanceOf(DeviceFlowError);
  });
});

describe('fetchDeviceSignIn', () => {
  it('combines the server’s device client with its protected-resource metadata', async () => {
    const server = 'https://e.example';
    const graphql = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ data: { ssoSetup: { name: 'heautou', deviceClientId: 'agents' } } }),
        ),
    );
    const { fetch: metadata } = provider({
      [`${server}/.well-known/oauth-protected-resource`]: {
        body: { resource: `${server}/graphql`, authorization_servers: [`${ISSUER}/`] },
      },
    });
    vi.stubGlobal('fetch', graphql);
    try {
      expect(await fetchDeviceSignIn(`${server}/`, metadata)).toEqual({
        providerName: 'heautou',
        issuer: ISSUER,
        audience: `${server}/graphql`,
        clientId: 'agents',
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('is null when the server names no device client', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ data: { ssoSetup: { name: 'heautou', deviceClientId: null } } }),
          ),
      ),
    );
    try {
      expect(await fetchDeviceSignIn('https://e.example')).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
