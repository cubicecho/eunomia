import { describe, expect, it, vi } from 'vitest';
import {
  parseConfig,
  parseConfigText,
  patchConfigText,
  type StoredConfig,
  serializeConfig,
} from './config.ts';

const connected: StoredConfig = { serverUrl: 'http://localhost:4000', apiKey: 'key' };

describe('parseConfig', () => {
  it('keeps a config with both halves of the connection', () => {
    expect(parseConfig(connected)).toEqual(connected);
  });

  it('treats a half-configured file as no config at all', () => {
    // Either half missing sends the shell to its setup screen rather than
    // starting an agent that cannot reach anything.
    expect(parseConfig({ serverUrl: 'http://localhost:4000' })).toBeNull();
    expect(parseConfig({ apiKey: 'key' })).toBeNull();
    expect(parseConfig({})).toBeNull();
    expect(parseConfig(null)).toBeNull();
    expect(parseConfig('http://localhost:4000')).toBeNull();
  });

  it('carries the optional fields every shell may persist', () => {
    const full: StoredConfig = {
      ...connected,
      deviceId: 'dev_1',
      deviceName: 'laptop',
      autostart: false,
      backgroundSync: true,
      keepAlive: false,
      launchableAppsOnly: true,
      syncIntervalSeconds: 900,
      ignoreApps: ['keepass'],
      redactApps: ['firefox'],
    };
    expect(parseConfig(full)).toEqual(full);
  });

  it('drops fields of the wrong type rather than carrying them', () => {
    expect(
      parseConfig({
        ...connected,
        deviceId: 7,
        autostart: 'yes',
        syncIntervalSeconds: '900',
        ignoreApps: ['ok', 3],
        redactApps: 'firefox',
      }),
    ).toEqual(connected);
  });

  it('drops keys it does not know, so a downgrade cannot re-serialize them', () => {
    expect(parseConfig({ ...connected, futureSetting: true })).toEqual(connected);
  });

  it('keeps false and empty arrays, which are answers rather than absences', () => {
    const off: StoredConfig = { ...connected, autostart: false, ignoreApps: [] };
    expect(parseConfig(off)).toEqual(off);
  });
});

describe('parseConfigText', () => {
  it('parses the text a shell read off disk', () => {
    expect(parseConfigText(JSON.stringify(connected))).toEqual(connected);
  });

  it('treats a missing file as no config', () => {
    expect(parseConfigText(null)).toBeNull();
  });

  it('treats an unreadable file the way a missing one is treated', () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(parseConfigText('{ not json')).toBeNull();
    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
  });
});

describe('serializeConfig', () => {
  it('round-trips through parseConfigText', () => {
    const config: StoredConfig = { ...connected, deviceName: 'laptop', keepAlive: true };
    expect(parseConfigText(serializeConfig(config))).toEqual(config);
  });

  it('writes an indented file that ends in a newline', () => {
    const text = serializeConfig(connected);
    expect(text.endsWith('\n')).toBe(true);
    expect(text).toContain('\n  "serverUrl"');
  });
});

describe('patchConfigText', () => {
  it('merges over the raw object, leaving everything else alone', () => {
    const text = serializeConfig({ ...connected, deviceId: 'dev_1', ignoreApps: ['keepass'] });
    const patched: unknown = JSON.parse(patchConfigText(text, { autostart: false }));
    expect(patched).toEqual({
      ...connected,
      deviceId: 'dev_1',
      ignoreApps: ['keepass'],
      autostart: false,
    });
  });

  it('keeps keys this build would not parse — a toggle must not truncate the file', () => {
    const text = JSON.stringify({ ...connected, futureSetting: true });
    expect(JSON.parse(patchConfigText(text, { autostart: false }))).toMatchObject({
      futureSetting: true,
    });
  });

  it('writes a patch-only file when there is nothing on disk', () => {
    // Env-configured installs have no connection in the file to preserve.
    expect(JSON.parse(patchConfigText(null, { autostart: false }))).toEqual({ autostart: false });
  });

  it('replaces an unreadable file rather than refusing the toggle', () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(JSON.parse(patchConfigText('{ not json', { autostart: true }))).toEqual({
      autostart: true,
    });
    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
  });

  it('ends in a newline like a full write does', () => {
    expect(patchConfigText(null, { autostart: true }).endsWith('\n')).toBe(true);
  });
});
