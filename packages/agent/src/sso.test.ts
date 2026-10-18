import { describe, expect, it } from 'vitest';
import { base64Url, ssoStartUrl, ssoTokenFrom } from './sso.ts';

describe('agent SSO helpers', () => {
  it('asks the server to send the answer back, bound to the challenge', () => {
    const url = new URL(ssoStartUrl('https://e.example/sso/oidc', 'eunomia://sso', 'abc'));
    expect(url.searchParams.get('return_to')).toBe('eunomia://sso');
    expect(url.searchParams.get('code_challenge')).toBe('abc');
  });

  it('reads the token, or says why there is none', () => {
    expect(ssoTokenFrom('eunomia://sso?sso=tok')).toBe('tok');
    expect(() => ssoTokenFrom('http://127.0.0.1:5/sso?error=not_allowed')).toThrow(/not allowed/);
    expect(() => ssoTokenFrom('eunomia://sso')).toThrow(/without its token/);
  });

  it('encodes as unpadded base64url', () => {
    expect(base64Url(new Uint8Array([251, 255, 254]))).toBe('-__-');
  });
});
