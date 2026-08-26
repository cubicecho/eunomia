import { randomUUID } from 'node:crypto';
import { apiKey } from '@better-auth/api-key';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { bearer, magicLink } from 'better-auth/plugins';
import { eq } from 'drizzle-orm';
import type { Db } from './db/client.ts';
import { account, apikey, session, user, verification } from './db/schema.ts';
import { type MagicLinkMessage, sendMagicLinkEmail } from './email.ts';
import { forbidden } from './errors.ts';
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
}

// One-slot mailboxes for UNSAFE_LOCAL_NETWORK mode: signInMagicLink awaits
// sendMagicLink inline, so the gateway registers a captureId, the callback
// deposits the token instead of emailing it, and the mutation returns it.
const tokenCaptures = new Map<string, string>();

export function createAuth(db: Db, options: AuthOptions = {}) {
  return betterAuth({
    // The rc drizzle instance is keyed by relations, not tables, so the
    // adapter can't discover models from db._.fullSchema — map them explicitly.
    database: drizzleAdapter(db, {
      provider: 'pg',
      schema: { user, session, account, verification, apikey },
    }),
    secret: options.secret ?? process.env.BETTER_AUTH_SECRET,
    baseURL: options.baseURL ?? process.env.BETTER_AUTH_URL,
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
          // lives elsewhere (e.g. the vite dev server on :3000).
          const appUrl =
            options.appUrl ??
            (process.env.APP_URL || process.env.BETTER_AUTH_URL || 'http://localhost:4000');
          const url = `${appUrl}/?token=${encodeURIComponent(token)}`;
          await (options.sendMagicLink ?? sendMagicLinkEmail)({ email, url, token });
        },
      }),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;

/** What a device API key resolves to: the owning user and the provisioned device. */
export interface DeviceCredentials {
  userId: string;
  deviceId: string;
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
 * Resolves an `x-api-key` header value to the user + device it was minted for.
 * Invalid, disabled, expired, or non-device keys all resolve to null.
 */
export async function verifyDeviceKey(auth: Auth, key: string): Promise<DeviceCredentials | null> {
  const result = await auth.api.verifyApiKey({ body: { key } });
  if (!result.valid || !result.key) return null;
  const metadata = result.key.metadata as Record<string, unknown> | null;
  const deviceId = metadata?.deviceId;
  if (typeof deviceId !== 'string') return null;
  return { userId: result.key.referenceId, deviceId };
}

export interface AuthSession {
  /** Raw session token; send back as `Authorization: Bearer <token>` (bearer plugin). */
  token: string;
  userId: string;
}

/**
 * The auth operations the GraphQL layer needs — the server exposes no
 * better-auth REST routes, so these are the only way auth is reached. Injected
 * into createSchema as an interface so tests can stub it.
 */
export interface AuthGateway {
  mintDeviceKey(input: { userId: string; deviceId: string; name: string }): Promise<string>;
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
  auth: Auth,
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
    mintDeviceKey: (input) => mintDeviceKey(auth, input),

    async requestMagicLink(email) {
      assertAllowed(email);
      // Closed sign-ups stop here rather than at verify time: better-auth would
      // happily email a link to a stranger and only refuse once they clicked
      // it. Reporting the same ok/null as a real request keeps the response
      // from telling a prober which addresses have accounts.
      if (policy.disableSignUp && !(await hasAccount(email))) return { token: null };

      if (!gatewayOptions.exposeMagicLinkToken) {
        await auth.api.signInMagicLink({ body: { email }, headers: new Headers() });
        return { token: null };
      }
      const captureId = randomUUID();
      tokenCaptures.set(captureId, '');
      try {
        await auth.api.signInMagicLink({
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
      const result = await auth.api.magicLinkVerify({ query: { token }, headers: new Headers() });
      return { token: result.token, userId: result.user.id };
    },

    async signUp(input) {
      assertAllowed(input.email);
      if (policy.disableSignUp) throw forbidden('This server is not accepting new accounts');
      const result = await auth.api.signUpEmail({ body: input });
      // autoSignIn is on by default; a null token would mean it was disabled.
      if (!result.token) throw new Error('Sign-up did not open a session');
      return { token: result.token, userId: result.user.id };
    },

    async signIn(input) {
      // Also checked here: an allowlist narrowed after the fact should lock out
      // accounts it no longer covers, not just block new ones.
      assertAllowed(input.email);
      const result = await auth.api.signInEmail({ body: input });
      return { token: result.token, userId: result.user.id };
    },

    async signOut(headers) {
      // The endpoint reports success even with no session (it just clears
      // cookies), so check for a live one to give the caller a truthful bool.
      const session = await auth.api.getSession({ headers });
      if (!session) return false;
      await auth.api.signOut({ headers });
      return true;
    },
  };
}
