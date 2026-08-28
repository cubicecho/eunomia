import type { AuthGateway } from '../auth.ts';
import { rateLimited, unauthenticated } from '../errors.ts';
import type { MutationResolvers } from '../gql/resolvers.ts';
import { createRateLimiter } from '../rate-limit.ts';

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

export function authFields(auth: AuthGateway) {
  const perEmailLogins = createRateLimiter(LOGIN_ATTEMPTS_PER_EMAIL, LOGIN_WINDOW_MS);
  const allLogins = createRateLimiter(LOGIN_ATTEMPTS_TOTAL, LOGIN_WINDOW_MS);
  const throttleLogin = (email: string): void => {
    if (!perEmailLogins.allow(email.trim().toLowerCase()) || !allLogins.allow('*')) {
      throw rateLimited('Too many sign-in attempts; try again in a few minutes');
    }
  };

  return {
    signUp: (_source, args) => {
      throttleLogin(args.email);
      return auth.signUp(args);
    },
    signIn: (_source, args) => {
      throttleLogin(args.email);
      return auth.signIn(args);
    },
    requestMagicLink: async (_source, args) => {
      const email = args.email.toLowerCase().trim();
      throttleLogin(email);
      const { token } = await auth.requestMagicLink(email);
      return { ok: true, token };
    },
    verifyMagicLink: (_source, args) => auth.verifyMagicLink(args.token),
    signOut: (_source, _args, ctx) => auth.signOut(ctx.headers),
    sessionFromDeviceKey: (_source, _args, ctx) => {
      if (!ctx.deviceId || !ctx.userId) throw unauthenticated();
      return auth.sessionForDevice(ctx.userId);
    },
  } satisfies MutationResolvers;
}
