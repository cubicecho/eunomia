import { and, eq } from 'drizzle-orm';
import { createRemoteJWKSet, errors, type JWTPayload, jwtVerify } from 'jose';
import type { Db } from '../db/client.ts';
import { account, user } from '../db/schema.ts';
import { OIDC_PROVIDER_ID } from './config.ts';

// Access tokens the OIDC provider issued for eunomia's API (RFC 9068), accepted
// as a bearer in place of a session. The agents (desktop, Android) run the
// device flow (RFC 8628) at the provider, never in a browser here, and call the
// API with the token they got back. The token is a person signing in, as a
// session is: it is mapped to the eunomia account that signed in through the
// same provider, and only through that account's `account` row. Never by
// email: an address is something the provider's other clients can claim too,
// and a `sub` is the one thing the provider vouches for.

/**
 * The signature algorithms a provider token may use: asymmetric ones only.
 * `none` would be no signature, and an HS* key would be a secret eunomia does
 * not hold, so neither is ever accepted, whatever the provider advertises.
 */
export const PROVIDER_TOKEN_ALGORITHMS = [
  'RS256',
  'RS384',
  'RS512',
  'PS256',
  'PS384',
  'PS512',
  'ES256',
  'ES384',
  'ES512',
  'EdDSA',
  'Ed25519',
] as const;

/** The `typ` header RFC 9068 gives a JWT access token. jose also accepts `application/at+jwt`. */
export const ACCESS_TOKEN_TYP = 'at+jwt';

/** What a provider that advertises no algorithm signs with: RS256 is the one OIDC makes every provider support. */
const FALLBACK_ALGORITHM = 'RS256';

/**
 * The claims a token must carry, beyond the issuer and audience checked by
 * value. Not `scope` or `client_id`: heautou leaves `scope` out for an API that
 * defines none, and which of its clients asked does not change who the person is.
 */
const REQUIRED_CLAIMS = ['sub', 'exp'];

/** How far a token's `exp`, `iat` and `nbf` may be off from this server's clock. */
const CLOCK_TOLERANCE_SECONDS = 30;
/** How long fetching the provider's discovery document or keys may take before a token is refused. */
const FETCH_TIMEOUT_MS = 5_000;

/** Three base64url parts, the last of which may be empty. A better-auth session token has no dots. */
const JWT_SHAPE = /^[\w-]+\.[\w-]+\.[\w-]*$/;

/** What a provider's discovery document says that verifying a token needs. */
interface Discovery {
  /** The issuer exactly as the provider writes it, which is what its tokens' `iss` carry. */
  issuer: string;
  keys: ReturnType<typeof createRemoteJWKSet>;
  algorithms: string[];
}

/** A provider token that verified. */
export interface VerifiedProviderToken {
  /** The provider's id for the person. */
  sub: string;
  /** When the token stops being good. */
  expiresAt: Date;
}

/** Verifies access tokens from one provider, for one audience. */
export interface ProviderTokens {
  /** The issuer tokens must come from. */
  readonly issuer: string;
  /** The audience tokens must be issued for. */
  readonly audience: string;
  /** Checks a token's signature, issuer, audience, `typ` and lifetime. Null when it is not good for any reason. */
  verify(token: string): Promise<VerifiedProviderToken | null>;
}

/**
 * Whether a bearer has a JWT's shape. A better-auth session token has no dots,
 * so this tells the two apart without a lookup.
 */
export function looksLikeJwt(token: string): boolean {
  return JWT_SHAPE.test(token);
}

/**
 * The verifier for one provider. Its discovery document and keys are fetched
 * on the first token and kept, and the keys are fetched again when a token
 * names one they do not have, which is how a key rotation reaches here. The
 * auth host builds a new verifier whenever the provider changes, so nothing
 * from the last one is trusted.
 */
export function createProviderTokens(issuer: string, audience: string): ProviderTokens {
  let discovery: Promise<Discovery> | undefined;
  const discovered = (): Promise<Discovery> => {
    discovery ??= discover(issuer).catch((error: unknown) => {
      // Not kept: a provider that was down a moment ago may be up for the next token.
      discovery = undefined;
      throw error;
    });
    return discovery;
  };

  return {
    issuer,
    audience,
    async verify(token) {
      let found: Discovery;
      try {
        found = await discovered();
      } catch (error) {
        console.warn(
          `[auth] cannot read ${issuer}'s discovery document, so its access tokens are refused:`,
          error instanceof Error ? error.message : String(error),
        );
        return null;
      }
      try {
        const { payload } = await jwtVerify(token, found.keys, {
          issuer: found.issuer,
          audience,
          typ: ACCESS_TOKEN_TYP,
          algorithms: found.algorithms,
          clockTolerance: CLOCK_TOLERANCE_SECONDS,
          requiredClaims: REQUIRED_CLAIMS,
        });
        return verified(payload);
      } catch (error) {
        // A token that fails a check is a refusal, not a fault, so it is not
        // logged. Keys that could not be fetched are.
        const isRefusal =
          error instanceof errors.JOSEError && !(error instanceof errors.JWKSTimeout);
        if (!isRefusal) {
          console.warn(
            `[auth] could not check an access token from ${issuer}:`,
            error instanceof Error ? error.message : String(error),
          );
        }
        return null;
      }
    },
  };
}

/**
 * Reads the provider's discovery document: where its keys are, and which
 * algorithms it signs with, narrowed to PROVIDER_TOKEN_ALGORITHMS. Throws when
 * the document can't be read, names another issuer, or names no keys.
 */
async function discover(issuer: string): Promise<Discovery> {
  const response = await fetch(`${issuer}/.well-known/openid-configuration`, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`discovery answered ${response.status}`);
  const document = (await response.json()) as Record<string, unknown>;
  const named = typeof document.issuer === 'string' ? document.issuer : '';
  // A document naming another issuer would hand over someone else's keys.
  if (named.replace(/\/+$/, '') !== issuer.replace(/\/+$/, '')) {
    throw new Error(`discovery names another issuer (${named || 'none'})`);
  }
  const jwksUri = typeof document.jwks_uri === 'string' ? document.jwks_uri : '';
  if (!URL.canParse(jwksUri)) throw new Error('discovery has no jwks_uri');
  const allowed: readonly string[] = PROVIDER_TOKEN_ALGORITHMS;
  const advertised = Array.isArray(document.id_token_signing_alg_values_supported)
    ? document.id_token_signing_alg_values_supported.filter(
        (alg): alg is string => typeof alg === 'string',
      )
    : [];
  const algorithms = advertised.filter((alg) => allowed.includes(alg));
  return {
    issuer: named,
    keys: createRemoteJWKSet(new URL(jwksUri), { timeoutDuration: FETCH_TIMEOUT_MS }),
    algorithms: algorithms.length > 0 ? algorithms : [FALLBACK_ALGORITHM],
  };
}

/** The subject and expiry off a verified token, or null when either is missing. */
function verified(payload: JWTPayload): VerifiedProviderToken | null {
  if (typeof payload.sub !== 'string' || payload.sub === '' || typeof payload.exp !== 'number') {
    return null;
  }
  return { sub: payload.sub, expiresAt: new Date(payload.exp * 1000) };
}

/**
 * The eunomia account a provider's `sub` signed in as: the one whose `account`
 * row for the OIDC provider has it. A person who has never signed in to
 * eunomia through the provider has none, and must once, in a browser, first.
 */
export async function userForSubject(db: Db, sub: string): Promise<string | null> {
  const [row] = await db
    .select({ userId: user.id })
    .from(account)
    .innerJoin(user, eq(user.id, account.userId))
    .where(and(eq(account.providerId, OIDC_PROVIDER_ID), eq(account.accountId, sub)))
    .limit(1);
  return row?.userId ?? null;
}
