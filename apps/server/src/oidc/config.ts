// Sign-in through an OpenID Connect provider (heautou, Keycloak, Authentik, …),
// next to magic links. The provider comes from OIDC_* in the environment, or
// from a pairing an admin made in the dashboard (pairing.ts); the environment
// wins. Either way better-auth's genericOAuth plugin runs the flow (auth.ts) and
// http.ts carries its two browser legs.

/** The id the provider is registered under in better-auth, and so the last part of its callback path. */
export const OIDC_PROVIDER_ID = 'oidc';

/** How a confidential client may send its secret to the token endpoint. */
export const OIDC_CLIENT_AUTH_METHODS = ['client_secret_basic', 'client_secret_post'] as const;
export type OidcClientAuth = (typeof OIDC_CLIENT_AUTH_METHODS)[number];

/** What the sign-in button calls a provider that gives no name of its own. */
export const DEFAULT_OIDC_NAME = 'SSO';

/** Where a browser starts an OIDC sign-in. */
export const SSO_START_PATH = `/sso/${OIDC_PROVIDER_ID}`;
/** Where the provider sends the browser back: better-auth's callback at its default base path. */
export const SSO_CALLBACK_PATH = `/api/auth/callback/${OIDC_PROVIDER_ID}`;

export interface OidcConfig {
  /** No trailing slash; the discovery document is `/.well-known/openid-configuration` under it. */
  issuer: string;
  clientId: string;
  /** Unset for a public client, which proves itself with PKCE alone. */
  clientSecret: string | undefined;
  clientAuth: OidcClientAuth;
  /** What the sign-in page's button calls the provider. */
  name: string;
}

const trimmed = (value: string | undefined): string => value?.trim() ?? '';
const noTrailingSlash = (url: string): string => url.replace(/\/+$/, '');

/** The provider OIDC_ISSUER and OIDC_CLIENT_ID name, or null when either is unset. */
export function oidcConfigFromEnv(env: NodeJS.ProcessEnv = process.env): OidcConfig | null {
  const issuer = trimmed(env.OIDC_ISSUER);
  const clientId = trimmed(env.OIDC_CLIENT_ID);
  if (!issuer || !clientId) return null;
  return {
    issuer: noTrailingSlash(issuer),
    clientId,
    clientSecret: trimmed(env.OIDC_CLIENT_SECRET) || undefined,
    clientAuth:
      trimmed(env.OIDC_CLIENT_AUTH) === 'client_secret_post'
        ? 'client_secret_post'
        : 'client_secret_basic',
    name: trimmed(env.OIDC_NAME) || DEFAULT_OIDC_NAME,
  };
}

/**
 * A reason the OIDC environment can't be used, or null. Half a setup would
 * leave the sign-in page without its button and no clue why, and a typo in the
 * issuer would only show at the first sign-in, so the server refuses to boot.
 */
export function oidcEnvProblem(env: NodeJS.ProcessEnv = process.env): string | null {
  const issuer = trimmed(env.OIDC_ISSUER);
  const clientId = trimmed(env.OIDC_CLIENT_ID);
  if (!issuer !== !clientId) {
    return 'OIDC_ISSUER and OIDC_CLIENT_ID go together: set both to sign in with an OIDC provider, or neither';
  }
  if (issuer && !URL.canParse(issuer)) return `OIDC_ISSUER is not a URL: ${issuer}`;
  const clientAuth = trimmed(env.OIDC_CLIENT_AUTH);
  if (clientAuth && !(OIDC_CLIENT_AUTH_METHODS as readonly string[]).includes(clientAuth)) {
    return `OIDC_CLIENT_AUTH must be one of ${OIDC_CLIENT_AUTH_METHODS.join(', ')}`;
  }
  return null;
}

/**
 * Where a browser reaches this server: the OIDC start and callback routes live
 * here, and the redirect URI registered with the provider is built from it.
 * BETTER_AUTH_URL, which is better-auth's own base URL.
 */
export function serverUrl(env: NodeJS.ProcessEnv = process.env): string {
  const configured = trimmed(env.BETTER_AUTH_URL);
  return configured ? noTrailingSlash(configured) : `http://localhost:${env.PORT ?? 4000}`;
}

/**
 * Where the dashboard lives, which a finished sign-in lands on. The container
 * serves it itself, so it is the server's URL unless APP_URL says otherwise
 * (the vite dev server on :3000, say).
 */
export function appUrl(env: NodeJS.ProcessEnv = process.env): string {
  const configured = trimmed(env.APP_URL);
  return configured ? noTrailingSlash(configured) : serverUrl(env);
}

/** The redirect URI to register with the provider. */
export function oidcRedirectUri(env: NodeJS.ProcessEnv = process.env): string {
  return `${serverUrl(env)}${SSO_CALLBACK_PATH}`;
}
