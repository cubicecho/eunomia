import { type Auth, type AuthOptions, createAuth } from './auth.ts';
import type { Db } from './db/client.ts';
import { type OidcConfig, oidcApiAudience } from './oidc/config.ts';
import { createProviderTokens, type ProviderTokens } from './oidc/provider-tokens.ts';
import { effectiveOidc } from './oidc/settings.ts';

// better-auth fixes its plugins when it is created, and the OIDC provider is
// one of them. Pairing or unpairing a provider while the server runs therefore
// means a new instance, so everything that signs people in asks this host for
// the current one on each request instead of holding on to one from boot.

export interface AuthHost {
  /** The auth instance to use for this request. */
  current(): Auth;
  /** The OIDC provider `current()` was built with, or null. */
  oidc(): OidcConfig | null;
  /**
   * What checks that provider's access tokens as bearers, or null with no
   * provider. Built with the instance, so a new pairing never trusts the last
   * provider's keys.
   */
  providerTokens(): ProviderTokens | null;
  /** Builds a new instance from the provider in use now (oidc/settings.ts). */
  rebuild(): Promise<void>;
}

/**
 * A host over the environment's provider, or the database's pairing when the
 * environment names none. Migrations must have run: the pairing lives in a table.
 */
export async function createAuthHost(
  db: Db,
  options: Omit<AuthOptions, 'oidc'> = {},
): Promise<AuthHost> {
  const build = async () => {
    const { config } = await effectiveOidc(db);
    return {
      auth: createAuth(db, { ...options, oidc: config }),
      oidc: config,
      tokens: tokensFor(config),
    };
  };
  let built = await build();
  return {
    current: () => built.auth,
    oidc: () => built.oidc,
    providerTokens: () => built.tokens,
    async rebuild() {
      built = await build();
    },
  };
}

/**
 * A host that never changes, for a caller (a test, mostly) that already has its
 * instance. `tokens` overrides the verifier built from `oidc`.
 */
export function fixedAuthHost(
  auth: Auth,
  oidc: OidcConfig | null = null,
  rebuild: () => Promise<void> = async () => {},
  tokens: ProviderTokens | null = tokensFor(oidc),
): AuthHost {
  return { current: () => auth, oidc: () => oidc, providerTokens: () => tokens, rebuild };
}

/** The access-token verifier for a provider, against the API audience as it is set now. Null: no JWT is a bearer. */
function tokensFor(oidc: OidcConfig | null): ProviderTokens | null {
  return oidc === null ? null : createProviderTokens(oidc.issuer, oidcApiAudience());
}
