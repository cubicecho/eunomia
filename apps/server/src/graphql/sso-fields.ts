import type { MutationResolvers, QueryResolvers } from '@eunomia/gql/resolvers';
import { GraphQLError } from 'graphql';
import type { AuthGateway } from '../auth.ts';
import type { Db } from '../db/client.ts';
import { badInput, forbidden } from '../errors.ts';
import { oidcRedirectUri, SSO_START_PATH, serverUrl } from '../oidc/config.ts';
import { PairingError, PairingFailure, pair, unpair } from '../oidc/pairing.ts';
import { effectiveOidc, hasUsers, isAdmin, type SsoSource } from '../oidc/settings.ts';
import type { Context } from './context.ts';

// Pairing the instance with an OIDC provider from the dashboard (oidc/pairing.ts):
// paste the setup URL the provider gave you, and its button appears on the
// sign-in page without a restart.
//
// Who may pair: the admin, or anyone at all while the instance is brand new (no
// accounts yet), so whoever installs eunomia can set sign-in up from the
// sign-in page before there is an admin to ask. The first account becomes the
// admin (oidc/settings.ts). Once anyone has an account, a stranger could
// otherwise point sign-in at a provider of their own and sign in as any
// existing address, so only the admin may — and only from a signed-in session,
// never an API key.
//
// A provider set in the environment (OIDC_ISSUER) wins, and can't be changed
// from here.

async function canPair(db: Db, ctx: Context, source: SsoSource): Promise<boolean> {
  if (source === 'ENV') return false;
  if (ctx.userId && !ctx.keyId && (await isAdmin(db, ctx.userId))) return true;
  return !(await hasUsers(db));
}

async function ssoSetup(db: Db, ctx: Context) {
  const { config, source } = await effectiveOidc(db);
  const mayPair = await canPair(db, ctx, source);
  return {
    source,
    name: config?.name ?? null,
    signInUrl: config ? `${serverUrl()}${SSO_START_PATH}` : null,
    issuer: mayPair ? (config?.issuer ?? null) : null,
    canPair: mayPair,
    redirectUri: oidcRedirectUri(),
  };
}

/** Refuses a caller who may not pair, saying where it can be changed instead. */
async function requirePairing(db: Db, ctx: Context): Promise<SsoSource> {
  const { source } = await effectiveOidc(db);
  if (source === 'ENV') {
    throw forbidden("Sign-in is set by OIDC_ISSUER in the server's environment. Change it there.");
  }
  if (!(await canPair(db, ctx, source))) {
    throw forbidden('Only the admin can change how people sign in.');
  }
  return source;
}

/** A pairing failure as an API error carrying its reason for the dashboard. */
function pairingError(error: unknown): unknown {
  if (!(error instanceof PairingError)) return error;
  const code = error.reason === PairingFailure.RateLimited ? 'RATE_LIMITED' : 'BAD_USER_INPUT';
  return new GraphQLError(error.message, { extensions: { code, reason: error.reason } });
}

export function ssoQueryFields(db: Db) {
  return {
    ssoSetup: (_source, _args, ctx) => ssoSetup(db, ctx),
  } satisfies QueryResolvers;
}

export function ssoFields(db: Db, auth: AuthGateway) {
  return {
    pairSso: async (_source, args, ctx) => {
      const source = await requirePairing(db, ctx);
      if (source === 'PAIRED') {
        throw new GraphQLError('eunomia is already paired with a provider. Disconnect it first.', {
          extensions: { code: 'CONFLICT' },
        });
      }
      if (args.setupUrl.trim() === '')
        throw badInput('Paste the setup URL your provider gave you.');
      try {
        await pair(db, args.setupUrl);
      } catch (error) {
        throw pairingError(error);
      }
      await auth.reloadSso();
      return ssoSetup(db, ctx);
    },
    unpairSso: async (_source, _args, ctx) => {
      await requirePairing(db, ctx);
      await unpair(db);
      await auth.reloadSso();
      return ssoSetup(db, ctx);
    },
  } satisfies MutationResolvers;
}
