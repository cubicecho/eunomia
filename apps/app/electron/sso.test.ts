import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { signInWithBrowser } from './sso.ts';

// The browser is played by a fetch to wherever the start URL says to come back
// to — exactly what the server's redirect would make it do.

/** An openExternal that "signs in" by following the start URL's return_to with `answer`. */
function browserThatReturns(answer: Record<string, string>, seen: URL[] = []) {
  return async (url: string) => {
    const start = new URL(url);
    seen.push(start);
    const back = new URL(start.searchParams.get('return_to') ?? '');
    for (const [name, value] of Object.entries(answer)) back.searchParams.set(name, value);
    // Not awaited by the "browser" in real life either; the page answers it.
    void fetch(back);
  };
}

describe('signInWithBrowser', () => {
  it('waits on a loopback port and binds the answer to its verifier', async () => {
    const seen: URL[] = [];
    const credential = await signInWithBrowser(
      'https://eunomia.example/sso/oidc',
      browserThatReturns({ sso: 'ott' }, seen),
    );

    expect(credential.token).toBe('ott');
    const start = seen[0]!;
    expect(start.origin + start.pathname).toBe('https://eunomia.example/sso/oidc');
    expect(start.searchParams.get('return_to')).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/sso$/);
    // The challenge is S256 of the verifier it resolved with, and nothing else.
    expect(start.searchParams.get('code_challenge')).toBe(
      createHash('sha256').update(credential.codeVerifier).digest('base64url'),
    );
  });

  it('says why when the server sends an error back', async () => {
    await expect(
      signInWithBrowser(
        'https://eunomia.example/sso/oidc',
        browserThatReturns({ error: 'not_allowed' }),
      ),
    ).rejects.toThrow(/not allowed/);
  });

  it('never opens anything but a web address', async () => {
    await expect(signInWithBrowser('file:///etc/passwd', async () => {})).rejects.toThrow(
      /not a web page/,
    );
  });
});
