// Signing an agent in through the server's OIDC provider, from the system
// browser. The shells differ only in how the browser's answer comes back — the
// Android app's `eunomia://` scheme, or a loopback port the desktop app listens
// on — so building the start URL and reading the answer live here.
//
// The sign-in is bound to the agent that started it: the start URL carries a
// challenge (S256 of a random verifier), and the server only accepts the token
// it hands back together with that verifier. Something else on the device that
// catches the redirect gets a token it can't use.

/** What an OIDC sign-in handed back: the one-time token, and the verifier it is bound to. */
export interface SsoCredential {
  token: string;
  codeVerifier: string;
}

/** Where the Android app asks to be sent back to. Matches app.json's `scheme`. */
export const ANDROID_SSO_RETURN = 'eunomia://sso';

/** The server's start URL, asking for the answer at `returnTo` and binding it to `challenge`. */
export function ssoStartUrl(signInUrl: string, returnTo: string, challenge: string): string {
  const url = new URL(signInUrl);
  url.searchParams.set('return_to', returnTo);
  url.searchParams.set('code_challenge', challenge);
  return url.toString();
}

/** What a sign-in that came back with `?error=` tells the person. */
export function ssoErrorMessage(code: string): string {
  if (code === 'sso_off') return 'This server no longer has single sign-on set up.';
  if (code === 'not_allowed') return 'That account is not allowed on this server.';
  return "Signing in with your provider didn't work. Try again.";
}

/** The one-time token in the URL the browser came back with; throws what to tell the person otherwise. */
export function ssoTokenFrom(returned: string): string {
  const params = new URL(returned).searchParams;
  const error = params.get('error');
  if (error) throw new Error(ssoErrorMessage(error));
  const token = params.get('sso');
  if (!token) throw new Error('The sign-in came back without its token. Try again.');
  return token;
}

/** base64url without padding, the encoding PKCE uses. */
export function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
