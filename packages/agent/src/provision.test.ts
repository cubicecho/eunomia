import { beforeEach, describe, expect, it, vi } from 'vitest';
import { normalizeServerUrl, provisionDevice } from './provision.ts';

// The register-or-re-key decision is the whole point of this module — getting
// it wrong leaves half a machine's history on a device nothing uploads to any
// more — so the server calls are stubbed and the assertions are about which
// ones were made.
vi.mock('./api.ts', () => ({
  verifyMagicLink: vi.fn(async () => 'session-token'),
  registerDevice: vi.fn(async () => ({ deviceId: 'new-device', apiKey: 'new-key' })),
  rotateDeviceKey: vi.fn(async () => ({ deviceId: 'old-device', apiKey: 'rotated-key' })),
  renameDevice: vi.fn(async () => {}),
  signOut: vi.fn(async () => {}),
}));

const api = await import('./api.ts');

const input = {
  serverUrl: 'http://server:4000',
  tokenOrLink: 'token',
  name: 'laptop',
  platform: 'linux',
};

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
      apiKey: 'new-key',
      reKeyed: false,
    });
    expect(api.registerDevice).toHaveBeenCalledWith(
      'http://server:4000',
      'session-token',
      'laptop',
      'linux',
    );
    expect(api.rotateDeviceKey).not.toHaveBeenCalled();
  });

  it('re-keys the device this install already owns', async () => {
    const result = await provisionDevice({
      ...input,
      existing: { serverUrl: 'http://server:4000', deviceId: 'old-device', deviceName: 'laptop' },
    });

    expect(result).toEqual({
      serverUrl: 'http://server:4000',
      deviceId: 'old-device',
      apiKey: 'rotated-key',
      reKeyed: true,
    });
    expect(api.registerDevice).not.toHaveBeenCalled();
    // Same name as before: nothing to rename.
    expect(api.renameDevice).not.toHaveBeenCalled();
  });

  it('renames before re-keying when the name changed', async () => {
    await provisionDevice({
      ...input,
      name: 'work laptop',
      existing: { serverUrl: 'http://server:4000', deviceId: 'old-device', deviceName: 'laptop' },
    });

    expect(api.renameDevice).toHaveBeenCalledWith(
      'http://server:4000',
      'session-token',
      'old-device',
      'work laptop',
    );
    expect(api.rotateDeviceKey).toHaveBeenCalled();
  });

  it('re-keys across spellings of the same server', async () => {
    const result = await provisionDevice({
      ...input,
      serverUrl: 'http://server:4000/',
      existing: { serverUrl: ' http://server:4000 ', deviceId: 'old-device', deviceName: 'laptop' },
    });

    expect(result.reKeyed).toBe(true);
    expect(result.serverUrl).toBe('http://server:4000');
  });

  it('registers when pointed at a different server', async () => {
    const result = await provisionDevice({
      ...input,
      existing: { serverUrl: 'http://other:4000', deviceId: 'old-device', deviceName: 'laptop' },
    });

    expect(result.reKeyed).toBe(false);
    expect(api.registerDevice).toHaveBeenCalled();
  });

  it('registers when the existing config predates device ids', async () => {
    const result = await provisionDevice({
      ...input,
      existing: { serverUrl: 'http://server:4000' },
    });

    expect(result.reKeyed).toBe(false);
  });

  it('disposes of the session even when provisioning fails', async () => {
    vi.mocked(api.registerDevice).mockRejectedValueOnce(new Error('name taken'));

    await expect(provisionDevice(input)).rejects.toThrow('name taken');
    expect(api.signOut).toHaveBeenCalledWith('http://server:4000', 'session-token');
  });
});
