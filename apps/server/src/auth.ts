import { apiKey } from '@better-auth/api-key';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { bearer } from 'better-auth/plugins';
import type { Db } from './db/client.ts';
import { account, apikey, session, user, verification } from './db/schema.ts';

export interface AuthOptions {
  secret?: string | undefined;
  baseURL?: string | undefined;
}

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
    },
    plugins: [
      // Long-lived per-device agent tokens; sessions cover the dashboard.
      apiKey({ enableMetadata: true }),
      // The server is GraphQL-only (no better-auth REST routes, no cookies):
      // sign-in/sign-up mutations return the raw session token and clients
      // send it back as `Authorization: Bearer <token>`; this hook converts
      // that header into the session cookie getSession expects.
      bearer(),
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
  /** Revokes the session carried by the request headers. False if there wasn't one. */
  signOut(headers: Headers): Promise<boolean>;
}

export function createAuthGateway(auth: Auth): AuthGateway {
  return {
    mintDeviceKey: (input) => mintDeviceKey(auth, input),

    async signUp(input) {
      const result = await auth.api.signUpEmail({ body: input });
      // autoSignIn is on by default; a null token would mean it was disabled.
      if (!result.token) throw new Error('Sign-up did not open a session');
      return { token: result.token, userId: result.user.id };
    },

    async signIn(input) {
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
