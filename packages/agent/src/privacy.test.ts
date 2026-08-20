import { describe, expect, it } from 'vitest';
import type { Ping } from './ping.ts';
import { createSanitizer } from './privacy.ts';

const ping = (app: string | null): Ping => ({
  capturedAt: '2026-08-20T00:00:00.000Z',
  app,
  title: 'Secret document',
  context: 'secrets.example.com',
  idleSeconds: 0,
});

describe('createSanitizer', () => {
  it('passes pings through untouched with no config', () => {
    const sanitize = createSanitizer({});
    expect(sanitize(ping('firefox'))).toEqual(ping('firefox'));
  });

  it('drops pings from ignored apps, case-insensitively', () => {
    const sanitize = createSanitizer({ ignoreApps: ['^keepass', 'signal'] });
    expect(sanitize(ping('KeePassXC'))).toBeNull();
    expect(sanitize(ping('signal-desktop'))).toBeNull();
    expect(sanitize(ping('firefox'))).toEqual(ping('firefox'));
  });

  it('strips title and context from redacted apps, keeping the time', () => {
    const sanitize = createSanitizer({ redactApps: ['firefox'] });
    expect(sanitize(ping('firefox'))).toEqual({ ...ping('firefox'), title: null, context: null });
    expect(sanitize(ping('code'))).toEqual(ping('code'));
  });

  it('ignoring wins over redacting when both match', () => {
    const sanitize = createSanitizer({ ignoreApps: ['firefox'], redactApps: ['firefox'] });
    expect(sanitize(ping('firefox'))).toBeNull();
  });

  it('skips invalid regexes without dropping anything', () => {
    const sanitize = createSanitizer({ ignoreApps: ['[unclosed', 'keepass'] });
    expect(sanitize(ping('firefox'))).toEqual(ping('firefox'));
    expect(sanitize(ping('keepass'))).toBeNull();
  });

  it('never matches a null app', () => {
    const sanitize = createSanitizer({ ignoreApps: ['.*'] });
    expect(sanitize(ping(null))).toEqual(ping(null));
  });
});
