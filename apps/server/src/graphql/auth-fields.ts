import { GraphQLBoolean, GraphQLNonNull, GraphQLObjectType, GraphQLString } from 'graphql';
import type { AuthGateway } from '../auth.ts';
import { rateLimited, unauthenticated } from '../errors.ts';
import { createRateLimiter } from '../rate-limit.ts';
import type { Context } from './context.ts';
import type { Fields } from './entities.ts';

// Auth is GraphQL too — the server mounts no better-auth REST routes. Every
// field here is `accept` in the permissions map (they ARE the login flow),
// except sessionFromDeviceKey, which device keys alone may call.

// Login is unauthenticated, so its cost is borne by whoever can reach the
// port. Per-address first (that's the mailbombing target), then a total across
// all addresses so spraying can't walk around it. Generous enough that a
// household of real users never sees them.
const LOGIN_WINDOW_MS = 15 * 60_000;
const LOGIN_ATTEMPTS_PER_EMAIL = 5;
const LOGIN_ATTEMPTS_TOTAL = 100;

/**
 * Session payload for signUp/signIn: the raw session token goes back as
 * `Authorization: Bearer <token>` on every later request (bearer plugin).
 */
export const authSessionType = new GraphQLObjectType({
  name: 'AuthSession',
  fields: {
    token: { type: new GraphQLNonNull(GraphQLString) },
    userId: { type: new GraphQLNonNull(GraphQLString) },
  },
});

const magicLinkRequestType = new GraphQLObjectType({
  name: 'MagicLinkRequest',
  fields: {
    ok: { type: new GraphQLNonNull(GraphQLBoolean) },
    token: { type: GraphQLString },
  },
});

export function authFields(auth: AuthGateway) {
  const perEmailLogins = createRateLimiter(LOGIN_ATTEMPTS_PER_EMAIL, LOGIN_WINDOW_MS);
  const allLogins = createRateLimiter(LOGIN_ATTEMPTS_TOTAL, LOGIN_WINDOW_MS);
  const throttleLogin = (email: string): void => {
    if (!perEmailLogins.allow(email.trim().toLowerCase()) || !allLogins.allow('*')) {
      throw rateLimited('Too many sign-in attempts; try again in a few minutes');
    }
  };

  return {
    signUp: {
      type: new GraphQLNonNull(authSessionType),
      args: {
        email: { type: new GraphQLNonNull(GraphQLString) },
        password: { type: new GraphQLNonNull(GraphQLString) },
        name: { type: new GraphQLNonNull(GraphQLString) },
      },
      resolve: (_source, args: { email: string; password: string; name: string }) => {
        throttleLogin(args.email);
        return auth.signUp(args);
      },
    },
    signIn: {
      type: new GraphQLNonNull(authSessionType),
      args: {
        email: { type: new GraphQLNonNull(GraphQLString) },
        password: { type: new GraphQLNonNull(GraphQLString) },
      },
      resolve: (_source, args: { email: string; password: string }) => {
        throttleLogin(args.email);
        return auth.signIn(args);
      },
    },
    requestMagicLink: {
      // Primary login: emails a single-use sign-in link (account created on
      // first use). `token` is populated only under UNSAFE_LOCAL_NETWORK,
      // letting clients on a trusted LAN sign in without an inbox.
      type: new GraphQLNonNull(magicLinkRequestType),
      args: {
        email: { type: new GraphQLNonNull(GraphQLString) },
      },
      resolve: async (_source, args: { email: string }) => {
        const email = args.email.toLowerCase().trim();
        throttleLogin(email);
        const { token } = await auth.requestMagicLink(email);
        return { ok: true, token };
      },
    },
    verifyMagicLink: {
      type: new GraphQLNonNull(authSessionType),
      args: {
        token: { type: new GraphQLNonNull(GraphQLString) },
      },
      resolve: (_source, args: { token: string }) => auth.verifyMagicLink(args.token),
    },
    signOut: {
      // True if a live session was revoked; false if the request had none.
      type: new GraphQLNonNull(GraphQLBoolean),
      resolve: (_source, _args, ctx: Context) => auth.signOut(ctx.headers),
    },
    sessionFromDeviceKey: {
      // Trades a device API key (x-api-key) for a short-lived bearer session,
      // so the desktop app can open the dashboard in an embedded window
      // without a second sign-in — and without handing its long-lived key to
      // the web view. Device-key contexts only (see permissions); no throttle
      // needed since it requires a valid key.
      type: new GraphQLNonNull(authSessionType),
      resolve: (_source, _args, ctx: Context) => {
        if (!ctx.deviceId || !ctx.userId) throw unauthenticated();
        return auth.sessionForDevice(ctx.userId);
      },
    },
  } satisfies Fields;
}
