import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentCredential } from './credential.ts';
import { normalizeServerUrl, provisionDevice } from './provision.ts';

// The keep-or-register decision is the whole point of this module — getting
// it wrong leaves half a machine's history on a device nothing uploads to any
// more — so the server calls are stubbed and the assertions are about which
// ones were made.
vi.mock('./api.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./api.ts')>();
  return {
    ...actual,
    registerDevice: vi.fn(async () => 'new-device'),
    renameDevice: vi.fn(async () => {}),
  };
});

const api = await import('./api.ts');

const session: AgentCredential = { kind: 'session', token: 'session-token' };
const provider: AgentCredential = {
  kind: 'provider',
  accessToken: 'header.payload.sig',
  refreshToken: 'refresh',
  expiresAt: Date.now() + 300_000,
  issuer: 'https://id.example',
  clientId: 'agents',
  audience: 'http://server:4000/graphql',
  tokenEndpoint: 'https://id.example/token',
};

const input = {
  serverUrl: 'http://server:4000',
  credential: session,
  name: 'laptop',
  platform: 'linux',
};

const existing = { serverUrl: 'http://server:4000', deviceId: 'old-device', deviceName: 'laptop' };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('normalizeServerUrl', () => {
  it('strips whitespace and trailing slashes', () => {
    expect(normalizeServerUrl('  http://server:4000//  ')).toBe('http://server:4000');
  });
});

describe('provisionDevice', () => {
  it('registers when there is no existing device', async () => {
    const result = await provisionDevice(input);

    expect(result).toEqual({
      serverUrl: 'http://server:4000',
      deviceId: 'new-device',
      reconnected: false,
    });
    expect(api.registerDevice).toHaveBeenCalledWith(
      'http://server:4000',
      'session-token',
      'laptop',
      'linux',
    );
    expect(api.renameDevice).not.toHaveBeenCalled();
  });

  it('keeps the device this install already owns, renaming it as asked', async () => {
    const result = await provisionDevice({ ...input, name: 'desk', existing });

    expect(result).toEqual({
      serverUrl: 'http://server:4000',
      deviceId: 'old-device',
      reconnected: true,
    });
    expect(api.renameDevice).toHaveBeenCalledWith(
      'http://server:4000',
      'session-token',
      'old-device',
      'desk',
    );
    expect(api.registerDevice).not.toHaveBeenCalled();
  });

  it('signs in with a provider token as the bearer', async () => {
    await provisionDevice({ ...input, credential: provider, existing });
    expect(api.renameDevice).toHaveBeenCalledWith(
      'http://server:4000',
      'header.payload.sig',
      'old-device',
      'laptop',
    );
  });

  it('matches the server however its URL was spelled', async () => {
    const result = await provisionDevice({
      ...input,
      serverUrl: 'http://server:4000/',
      existing: { ...existing, serverUrl: ' http://server:4000// ' },
    });
    expect(result.reconnected).toBe(true);
  });

  it('registers on another server rather than keeping a device it never saw', async () => {
    const result = await provisionDevice({
      ...input,
      existing: { ...existing, serverUrl: 'http://elsewhere:4000' },
    });
    expect(result.reconnected).toBe(false);
    expect(api.renameDevice).not.toHaveBeenCalled();
  });

  it('registers again when the kept device is gone', async () => {
    vi.mocked(api.renameDevice).mockRejectedValueOnce(
      new api.GraphQLRequestError('Unknown device', 'NOT_FOUND'),
    );
    const result = await provisionDevice({ ...input, existing });
    expect(result).toMatchObject({ deviceId: 'new-device', reconnected: false });
  });

  it('passes on any other failure rather than registering a twin', async () => {
    vi.mocked(api.renameDevice).mockRejectedValueOnce(new Error('offline'));
    await expect(provisionDevice({ ...input, existing })).rejects.toThrow('offline');
    expect(api.registerDevice).not.toHaveBeenCalled();
  });

  it('says to sign in to the dashboard once when the server does not know the provider account', async () => {
    vi.mocked(api.registerDevice).mockRejectedValueOnce(
      new api.GraphQLRequestError('Not signed in', 'UNAUTHENTICATED'),
    );
    await expect(provisionDevice({ ...input, credential: provider })).rejects.toThrow(
      /Sign in to the eunomia dashboard with your provider once/,
    );
  });
});
