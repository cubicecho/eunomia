import { describe, expect, it, vi } from 'vitest';
import { GraphQLRequestError, withBearer } from './api.ts';
import {
  type AgentCredential,
  createTokenSource,
  createTokenSourceCache,
  parseCredential,
  SignedOutError,
} from './credential.ts';

const TOKEN_ENDPOINT = 'https://id.example/token';

const provider = (accessToken: string, expiresAt: number): AgentCredential => ({
  kind: 'provider',
  accessToken,
  refreshToken: `refresh-for-${accessToken}`,
  expiresAt,
  issuer: 'https://id.example',
  clientId: 'agents',
  audience: 'https://e.example/graphql',
  tokenEndpoint: TOKEN_ENDPOINT,
});

/** A token endpoint that hands out `fresh-1`, `fresh-2`, … and counts the refreshes. */
function tokenEndpoint(status = 200) {
  let issued = 0;
  const fetchImpl = vi.fn(async () => {
    if (status !== 200) return new Response(JSON.stringify({ error: 'invalid_grant' }), { status });
    issued += 1;
    return new Response(
      JSON.stringify({
        access_token: `fresh-${issued}`,
        refresh_token: `r${issued}`,
        expires_in: 300,
      }),
    );
  }) as unknown as typeof fetch;
  return fetchImpl;
}

describe('parseCredential', () => {
  it('reads both kinds, and nothing partial', () => {
    expect(parseCredential({ kind: 'session', token: 's' })).toEqual({
      kind: 'session',
      token: 's',
    });
    expect(parseCredential(provider('a', 1))).toEqual(provider('a', 1));
    expect(parseCredential({ kind: 'session' })).toBeNull();
    expect(parseCredential({ ...provider('a', 1), issuer: undefined })).toBeNull();
    expect(parseCredential({ kind: 'apiKey', key: 'k' })).toBeNull();
  });
});

describe('createTokenSource', () => {
  it('hands out a session as it is', async () => {
    const tokens = createTokenSource({ kind: 'session', token: 's' });
    expect(await tokens.bearer()).toBe('s');
    expect(await tokens.recover()).toBe(false);
  });

  it('refreshes a provider token near its expiry, saves it and tells listeners', async () => {
    const fetchImpl = tokenEndpoint();
    const save = vi.fn();
    const listener = vi.fn();
    const tokens = createTokenSource(provider('old', 30_000), {
      fetch: fetchImpl,
      save,
      now: () => 0,
    });
    tokens.subscribe(listener);

    expect(await tokens.bearer()).toBe('fresh-1');
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ accessToken: 'fresh-1', refreshToken: 'r1' }),
    );
    expect(listener).toHaveBeenCalledWith('fresh-1');
    // Good for five minutes now: no second refresh.
    expect(await tokens.bearer()).toBe('fresh-1');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('refreshes once for callers that arrive together', async () => {
    // A provider that rotates refresh tokens refuses the second of two
    // refreshes with the same one, which would sign the agent out.
    const fetchImpl = tokenEndpoint();
    const tokens = createTokenSource(provider('old', 0), { fetch: fetchImpl, now: () => 0 });
    const bearers = await Promise.all([tokens.bearer(), tokens.bearer(), tokens.recover()]);
    expect(bearers.slice(0, 2)).toEqual(['fresh-1', 'fresh-1']);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('is signed out when the provider refuses the refresh', async () => {
    const tokens = createTokenSource(provider('old', 0), {
      fetch: tokenEndpoint(400),
      now: () => 0,
    });
    await expect(tokens.bearer()).rejects.toBeInstanceOf(SignedOutError);
  });
});

describe('createTokenSourceCache', () => {
  it('gives the same source for the sign-in and what it refreshed to, and a new one for a new sign-in', async () => {
    const sources = createTokenSourceCache({ fetch: tokenEndpoint(), now: () => 0 });
    const first = sources(provider('old', 0));
    await first.bearer();
    expect(sources(provider('old', 0))).toBe(first);
    expect(sources(first.current())).toBe(first);
    expect(sources({ kind: 'session', token: 'other' })).not.toBe(first);
  });
});

describe('withBearer', () => {
  it('retries once with a refreshed token after the server refuses one', async () => {
    const tokens = createTokenSource(provider('stale', 10 * 60_000), {
      fetch: tokenEndpoint(),
      now: () => 0,
    });
    const graphql = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ errors: [{ message: 'no', extensions: { code: 'UNAUTHENTICATED' } }] }),
        ),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { signOut: true } })));
    vi.stubGlobal('fetch', graphql);
    try {
      await withBearer('https://e.example', tokens, (sdk) => sdk.SignOut({}));
      const sent = graphql.mock.calls.map(([, init]) => (init as RequestInit).headers);
      expect(sent).toEqual([
        expect.objectContaining({ authorization: 'Bearer stale' }),
        expect.objectContaining({ authorization: 'Bearer fresh-1' }),
      ]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('does not retry a session the server refused', async () => {
    const tokens = createTokenSource({ kind: 'session', token: 's' });
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              errors: [{ message: 'no', extensions: { code: 'UNAUTHENTICATED' } }],
            }),
          ),
      ),
    );
    try {
      await expect(
        withBearer('https://e.example', tokens, (sdk) => sdk.SignOut({})),
      ).rejects.toBeInstanceOf(GraphQLRequestError);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
