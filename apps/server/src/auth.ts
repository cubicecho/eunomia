import { randomUUID } from 'node:crypto';
import { apiKey } from '@better-auth/api-key';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { bearer, genericOAuth, magicLink, oneTimeToken } from 'better-auth/plugins';
import { eq } from 'drizzle-orm';
import type { AuthHost } from './auth-host.ts';
import type { Db } from './db/client.ts';
import { account, apikey, session, user, verification } from './db/schema.ts';
import { type MagicLinkMessage, sendMagicLinkEmail } from './email.ts';
import { badInput, forbidden } from './errors.ts';
import { appUrl, OIDC_PROVIDER_ID, type OidcConfig, serverUrl } from './oidc/config.ts';
import { releaseChallenge, verifierMatches } from './oidc/handoff.ts';
import { claimFirstAdmin } from './oidc/settings.ts';
import { emailAllowed, OPEN_REGISTRATION, type RegistrationPolicy } from './registration.ts';

export interface AuthOptions {
  secret?: string | undefined;
  baseURL?: string | undefined;
  /** Where the web dashboard lives; emailed magic links point here. */
  appUrl?: string | undefined;
  /** Delivery override (tests); defaults to SMTP-or-console email. */
  sendMagicLink?: ((message: MagicLinkMessage) => Promise<void>) | undefined;
  /**
   * Refuse to create accounts for addresses that don't have one yet. The
   * gateway also stops these before an email goes out; this is the backstop
   * that makes a token minted before the policy changed useless.
   */
  disableSignUp?: boolean | undefined;
  /**
   * ALLOWED_EMAILS. The gateway checks it before every password and magic-link
   * sign-in; this is the backstop for the one path the gateway never sees, an
   * OIDC callback creating an account.
   */
  allowedEmails?: string[] | undefined;
  /** The OIDC provider to offer, or null for none (see auth-host.ts, which picks it). */
  oidc?: OidcConfig | null | undefined;
}

/** How long the token an OIDC callback hands the dashboard lasts: just the hop to `/?sso=`. */
const ONE_TIME_TOKEN_MINUTES = 3;

// One-slot mailboxes for UNSAFE_LOCAL_NETWORK mode: signInMagicLink awaits
// sendMagicLink inline, so the gateway registers a captureId, the callback
// deposits the token instead of emailing it, and the mutation returns it.
const tokenCaptures = new Map<string, string>();

export function createAuth(db: Db, options: AuthOptions = {}) {
  const oidc = options.oidc ?? null;
  const dashboard = options.appUrl ?? appUrl();
  return betterAuth({
    // The rc drizzle instance is keyed by relations, not tables, so the
    // adapter can't discover models from db._.fullSchema — map them explicitly.
    database: drizzleAdapter(db, {
      provider: 'pg',
      schema: { user, session, account, verification, apikey },
    }),
    secret: options.secret ?? process.env.BETTER_AUTH_SECRET,
    // The OIDC callback is served here (oidc/http.ts), and the redirect URI
    // registered with the provider is built from the same URL.
    baseURL: options.baseURL ?? serverUrl(),
    // So an OIDC sign-in may finish on the dashboard when it is another origin
    // (the vite dev server).
    trustedOrigins: [new URL(dashboard).origin],
    databaseHooks: {
      user: {
        create: {
          // Every way an account is made goes through here, so this is where
          // ALLOWED_EMAILS stops an OIDC sign-in from creating one.
          before: async (candidate) =>
            emailAllowed(candidate.email, options.allowedEmails ?? []) ? undefined : false,
          // And where the first account becomes the admin.
          after: async (created) => claimFirstAdmin(db, created.id),
        },
      },
    },
    // An address the operator's own provider vouches for signs in to the
    // account that has it, even one made by a magic link (which proves the
    // address too) before OIDC was set up.
    ...(oidc ? { account: { accountLinking: { requireLocalEmailVerified: false } } } : {}),
    // Where an OIDC callback goes when it can't tell where the sign-in came
    // from: the dashboard, which says so, not better-auth's own error page.
    onAPIError: { errorURL: `${dashboard}/` },
    emailAndPassword: {
      enabled: true,
      disableSignUp: options.disableSignUp ?? false,
    },
    plugins: [
      // Long-lived per-device agent tokens; sessions cover the dashboard.
      apiKey({ enableMetadata: true }),
      // The server is GraphQL-only (no better-auth REST routes, no cookies):
      // sign-in/sign-up mutations return the raw session token and clients
      // send it back as `Authorization: Bearer <token>`; this hook converts
      // that header into the session cookie getSession expects.
      bearer(),
      // Primary login. The plugin's own `url` targets its REST verify route,
      // which this server never mounts — links point at the web app instead,
      // whose SPA calls the verifyMagicLink mutation with the token.
      magicLink({
        expiresIn: 15 * 60,
        storeToken: 'hashed',
        disableSignUp: options.disableSignUp ?? false,
        sendMagicLink: async ({ email, token, metadata }) => {
          const captureId = metadata?.captureId;
          if (typeof captureId === 'string' && tokenCaptures.has(captureId)) {
            tokenCaptures.set(captureId, token);
            return;
          }
          // The server serves the dashboard itself in deployments, so its own
          // URL is the right default; APP_URL only matters when the dashboard
          // lives elsewhere (e.g. the vite dev server on :3000). See appUrl().
          const url = `${dashboard}/?token=${encodeURIComponent(token)}`;
          await (options.sendMagicLink ?? sendMagicLinkEmail)({ email, url, token });
        },
      }),
      // How an OIDC sign-in reaches the dashboard: the callback mints one of
      // these, and the dashboard spends it with verifyOneTimeToken. The session
      // never rides in a URL or a cookie.
      oneTimeToken({
        expiresIn: ONE_TIME_TOKEN_MINUTES,
        storeToken: 'hashed',
        disableClientRequest: true,
        disableSetSessionCookie: true,
      }),
      ...(oidc ? [oidcPlugin(oidc, options.disableSignUp ?? false)] : []),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;

/**
 * The provider, through better-auth's generic OAuth plugin: endpoints, keys
 * and issuer come from the discovery document, the id token is checked against
 * them, and better-auth's own sign-in and callback endpoints run the flow
 * (state, PKCE, nonce).
 */
function oidcPlugin(oidc: OidcConfig, disableSignUp: boolean) {
  return genericOAuth({
    config: [
      {
        providerId: OIDC_PROVIDER_ID,
        discoveryUrl: `${oidc.issuer}/.well-known/openid-configuration`,
        requireIdTokenVerification: true,
        clientId: oidc.clientId,
        clientSecret: oidc.clientSecret,
        tokenEndpointAuth: { method: oidc.clientSecret ? oidc.clientAuth : 'none' },
        pkce: true,
        scopes: ['openid', 'profile', 'email'],
        // DISABLE_SIGNUP: an address with no account here is refused, the same
        // as it is for a magic link.
        disableSignUp,
        // A provider may release only a username, or no name at all.
        mapProfileToUser: (profile) => ({
          name:
            stringClaim(profile.name) ??
            stringClaim(profile.preferred_username) ??
            stringClaim(profile.email)?.split('@')[0] ??
            '',
        }),
      },
    ],
  });
}

const stringClaim = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() !== '' ? value : undefined;

/**
 * What an `x-api-key` resolves to. `deviceId` is set only for a device key — an
 * integration key issued from the dashboard authenticates as its owner and
 * nothing more. The two kinds and what separates them: src/api-keys.ts.
 */
export interface KeyCredentials {
  userId: string;
  keyId: string;
  deviceId: string | undefined;
}

/**
 * Mints the long-lived agent key for a freshly registered device. Server-side
 * call (no request headers), which is what lets us set the server-only
 * properties: the owning userId and rateLimitEnabled — the plugin's per-key
 * default of 10 requests/day would starve an agent pinging every ~10s.
 * Returns the plaintext key; only its hash is stored, so this is the one time
 * it exists.
 */
export async function mintDeviceKey(
  auth: Auth,
  input: { userId: string; deviceId: string; name: string },
): Promise<string> {
  const created = await auth.api.createApiKey({
    body: {
      userId: input.userId,
      name: input.name,
      metadata: { deviceId: input.deviceId },
      rateLimitEnabled: false,
    },
  });
  return created.key;
}

/**
 * Mints an integration key: the same long-lived credential a device gets, minus
 * the device. Issued from the dashboard for anything else that talks to this
 * server — an MCP client, a script — so it carries no `deviceId` metadata and
 * can never stand in for an agent.
 *
 * `expiresInDays` is better-auth's own window, and the plugin bounds it at
 * 1..365; omitted, the key does not expire. Returns the plaintext key — only
 * its hash is stored, so this is the one time it exists.
 */
export async function mintUserKey(
  auth: Auth,
  input: { userId: string; name: string; expiresInDays?: number | undefined },
): Promise<{ id: string; key: string }> {
  const created = await auth.api.createApiKey({
    body: {
      userId: input.userId,
      name: input.name,
      // Same reason as a device key: the plugin's per-key default of 10
      // requests/day would starve anything that actually polls.
      rateLimitEnabled: false,
      ...(input.expiresInDays === undefined
        ? {}
        : { expiresIn: input.expiresInDays * 24 * 60 * 60 }),
    },
  });
  return { id: created.id, key: created.key };
}

/**
 * Resolves an `x-api-key` header value to its owner, and to the device it was
 * minted for when it is a device key. Invalid, disabled and expired keys all
 * resolve to null.
 */
export async function verifyApiKey(auth: Auth, key: string): Promise<KeyCredentials | null> {
  const result = await auth.api.verifyApiKey({ body: { key } });
  if (!result.valid || !result.key) return null;
  const metadata = result.key.metadata as Record<string, unknown> | null;
  const deviceId = metadata?.deviceId;
  return {
    userId: result.key.referenceId,
    keyId: result.key.id,
    deviceId: typeof deviceId === 'string' ? deviceId : undefined,
  };
}

export interface AuthSession {
  /** Raw session token; send back as `Authorization: Bearer <token>` (bearer plugin). */
  token: string;
  userId: string;
}

// Lifetime of a session minted from a device key. Short: the desktop mints a
// fresh one every time the dashboard window opens, so nothing needs to last.
const DEVICE_SESSION_SECONDS = 60 * 60;

/**
 * The auth operations the GraphQL layer needs — the server exposes no
 * better-auth REST routes, so these are the only way auth is reached. Injected
 * into createSchema as an interface so tests can stub it.
 */
export interface AuthGateway {
  mintDeviceKey(input: { userId: string; deviceId: string; name: string }): Promise<string>;
  /**
   * Mints a device-less API key for the user. Only the minting goes through
   * better-auth, which owns the hashing; listing, renaming and revoking are
   * plain reads and deletes on the table (src/api-keys.ts).
   */
  mintUserKey(input: {
    userId: string;
    name: string;
    expiresInDays?: number | undefined;
  }): Promise<{ id: string; key: string }>;
  /**
   * Opens a short-lived session for a device key's owner, so the desktop app
   * can show the dashboard without a second sign-in. Not an escalation: the
   * key already resolves to this userId and authorizes every user-scoped
   * field — this only lets the embedded web view hold a revocable, expiring
   * token instead of the key itself.
   */
  sessionForDevice(userId: string): Promise<AuthSession>;
  signUp(input: { email: string; password: string; name: string }): Promise<AuthSession>;
  signIn(input: { email: string; password: string }): Promise<AuthSession>;
  /**
   * Emails a single-use sign-in link (creating the account on first use).
   * Returns the raw magic token only in UNSAFE_LOCAL_NETWORK mode; null
   * otherwise.
   */
  requestMagicLink(email: string): Promise<{ token: string | null }>;
  /** Consumes a magic-link token and opens a session. */
  verifyMagicLink(token: string): Promise<AuthSession>;
  /** Revokes the session carried by the request headers. False if there wasn't one. */
  signOut(headers: Headers): Promise<boolean>;
  /**
   * The last leg of an OIDC sign-in: the one-time token the callback put on
   * the dashboard's URL, for a session. Spent, expired and made-up tokens are
   * all BAD_USER_INPUT — the sign-in has to be started again.
   */
  verifyOneTimeToken(token: string, codeVerifier?: string | null): Promise<AuthSession>;
  /** Rebuilds the auth instance after the OIDC provider changed (a pairing, or its removal). */
  reloadSso(): Promise<void>;
}

export interface AuthGatewayOptions {
  /**
   * UNSAFE_LOCAL_NETWORK: requestMagicLink returns the token in the GraphQL
   * response instead of emailing it, so anyone who can reach the server can
   * sign in as any email address. Only for trusted local networks.
   */
  exposeMagicLinkToken?: boolean;
  /** Who may hold an account here. Defaults to anyone (OPEN_REGISTRATION). */
  registration?: RegistrationPolicy;
}

export function createAuthGateway(
  host: AuthHost,
  db: Db,
  gatewayOptions: AuthGatewayOptions = {},
): AuthGateway {
  const policy = gatewayOptions.registration ?? OPEN_REGISTRATION;

  /**
   * The allowlist is static configuration, so saying "not this address" leaks
   * nothing about who has an account here — unlike DISABLE_SIGNUP, which is
   * enforced silently below precisely because it *would*.
   */
  const assertAllowed = (email: string): void => {
    if (!emailAllowed(email, policy.allowedEmails)) {
      throw forbidden('That email address is not allowed on this server');
    }
  };

  const hasAccount = async (email: string): Promise<boolean> => {
    const rows = await db
      .select({ id: user.id })
      .from(user)
      .where(eq(user.email, email.trim().toLowerCase()))
      .limit(1);
    return rows.length > 0;
  };

  return {
    mintDeviceKey: (input) => mintDeviceKey(host.current(), input),

    mintUserKey: (input) => mintUserKey(host.current(), input),

    async sessionForDevice(userId) {
      const ctx = await host.current().$context;
      // overrideAll: createSession spreads its default expiresAt *after* the
      // override, so a plain override can't shorten the session.
      const session = await ctx.internalAdapter.createSession(
        userId,
        false,
        { expiresAt: new Date(Date.now() + DEVICE_SESSION_SECONDS * 1000) },
        true,
      );
      return { token: session.token, userId };
    },

    async requestMagicLink(email) {
      assertAllowed(email);
      // Closed sign-ups stop here rather than at verify time: better-auth would
      // happily email a link to a stranger and only refuse once they clicked
      // it. Reporting the same ok/null as a real request keeps the response
      // from telling a prober which addresses have accounts.
      if (policy.disableSignUp && !(await hasAccount(email))) return { token: null };

      if (!gatewayOptions.exposeMagicLinkToken) {
        await host.current().api.signInMagicLink({ body: { email }, headers: new Headers() });
        return { token: null };
      }
      const captureId = randomUUID();
      tokenCaptures.set(captureId, '');
      try {
        await host.current().api.signInMagicLink({
          body: { email, metadata: { captureId } },
          headers: new Headers(),
        });
        const token = tokenCaptures.get(captureId);
        return { token: token ? token : null };
      } finally {
        tokenCaptures.delete(captureId);
      }
    },

    async verifyMagicLink(token) {
      const result = await host
        .current()
        .api.magicLinkVerify({ query: { token }, headers: new Headers() });
      return { token: result.token, userId: result.user.id };
    },

    async signUp(input) {
      assertAllowed(input.email);
      if (policy.disableSignUp) throw forbidden('This server is not accepting new accounts');
      const result = await host.current().api.signUpEmail({ body: input });
      // autoSignIn is on by default; a null token would mean it was disabled.
      if (!result.token) throw new Error('Sign-up did not open a session');
      return { token: result.token, userId: result.user.id };
    },

    async signIn(input) {
      // Also checked here: an allowlist narrowed after the fact should lock out
      // accounts it no longer covers, not just block new ones.
      assertAllowed(input.email);
      const result = await host.current().api.signInEmail({ body: input });
      return { token: result.token, userId: result.user.id };
    },

    async signOut(headers) {
      // The endpoint reports success even with no session (it just clears
      // cookies), so check for a live one to give the caller a truthful bool.
      const session = await host.current().api.getSession({ headers });
      if (!session) return false;
      await host.current().api.signOut({ headers });
      return true;
    },

    async verifyOneTimeToken(token, codeVerifier) {
      // An agent's sign-in is bound to the verifier it kept (oidc/handoff.ts).
      // Checked first, so a wrong guess doesn't spend the real agent's token.
      if (!verifierMatches(token, codeVerifier)) {
        throw badInput('Invalid or expired sign-in. Sign in again.');
      }
      releaseChallenge(token);
      try {
        const result = await host
          .current()
          .api.verifyOneTimeToken({ body: { token }, headers: new Headers() });
        return { token: result.session.token, userId: result.user.id };
      } catch {
        throw badInput('Invalid or expired sign-in. Sign in again.');
      }
    },

    reloadSso: () => host.rebuild(),
  };
}
