import { type Auth, type AuthOptions, createAuth } from './auth.ts';
import type { Db } from './db/client.ts';
import type { OidcConfig } from './oidc/config.ts';
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
    return { auth: createAuth(db, { ...options, oidc: config }), oidc: config };
  };
  let built = await build();
  return {
    current: () => built.auth,
    oidc: () => built.oidc,
    async rebuild() {
      built = await build();
    },
  };
}

/** A host that never changes, for a caller (a test, mostly) that already has its instance. */
export function fixedAuthHost(
  auth: Auth,
  oidc: OidcConfig | null = null,
  rebuild: () => Promise<void> = async () => {},
): AuthHost {
  return { current: () => auth, oidc: () => oidc, rebuild };
}
