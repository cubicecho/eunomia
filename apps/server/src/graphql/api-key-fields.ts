import type { ApiKey, MutationResolvers, QueryResolvers } from '@eunomia/gql/resolvers';
import {
  type ApiKeyRow,
  deleteKey,
  findIntegrationKey,
  listIntegrationKeys,
  renameKey,
} from '../api-keys.ts';
import type { AuthGateway } from '../auth.ts';
import type { Db } from '../db/client.ts';
import { badInput, notFound } from '../errors.ts';
import { requireUser } from './guards.ts';

// Integration keys: the credential another app authenticates to this server
// with, issued and withdrawn from the dashboard. Device keys live in
// device-fields.ts and are deliberately invisible here — revoking one of those
// retires an agent, which is a different question from withdrawing an
// integration.
//
// Every field here is session-only in the permissions map. An API key that
// could mint API keys would outlive being revoked.

/**
 * A ceiling, not a quota. The point is only that a runaway script can't fill
 * the table; nobody legitimately holds fifty integrations.
 */
const MAX_KEYS = 50;

/** better-auth's own bounds on a key's lifetime, restated so the error is ours. */
const MIN_EXPIRY_DAYS = 1;
const MAX_EXPIRY_DAYS = 365;

/** Dates cross the wire as ISO strings, like every other timestamp in this schema. */
function toGraphql(row: ApiKeyRow): ApiKey {
  return {
    id: row.id,
    name: row.name,
    start: row.start,
    createdAt: row.createdAt.toISOString(),
    lastUsedAt: row.lastRequest?.toISOString() ?? null,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    enabled: row.enabled,
  };
}

/** A name that will still mean something in a list six months from now. */
function requireName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) throw badInput('Give the key a name');
  return trimmed;
}

export function apiKeyQueryFields(db: Db) {
  return {
    apiKeys: async (_source, _args, ctx) =>
      (await listIntegrationKeys(db, requireUser(ctx))).map(toGraphql),
  } satisfies Pick<QueryResolvers, 'apiKeys'>;
}

export function apiKeyFields(db: Db, auth: AuthGateway) {
  return {
    // The plaintext key exists only in this response.
    createApiKey: async (_source, args, ctx) => {
      const userId = requireUser(ctx);
      const name = requireName(args.name);
      const expiresInDays = args.expiresInDays ?? undefined;
      if (
        expiresInDays !== undefined &&
        (expiresInDays < MIN_EXPIRY_DAYS || expiresInDays > MAX_EXPIRY_DAYS)
      ) {
        throw badInput(`Expiry must be between ${MIN_EXPIRY_DAYS} and ${MAX_EXPIRY_DAYS} days`);
      }
      const existing = await listIntegrationKeys(db, userId);
      if (existing.length >= MAX_KEYS) {
        throw badInput(`Too many API keys (max ${MAX_KEYS}) — revoke one first`);
      }

      const { id, key } = await auth.mintUserKey({ userId, name, expiresInDays });
      // Read the row back rather than assembling it from the mint arguments:
      // createdAt and the stored `start` are the plugin's to decide, and the
      // list this response is about to be prepended to comes from the table.
      const created = await findIntegrationKey(db, userId, id);
      if (!created) throw new Error('The minted API key was not stored');
      return { key: toGraphql(created), token: key };
    },
    // Renaming is the whole of "manage": everything else about a key is fixed
    // at minting, and a key whose expiry you want to change is a key you
    // should replace.
    renameApiKey: async (_source, args, ctx) => {
      const userId = requireUser(ctx);
      const name = requireName(args.name);
      const key = await findIntegrationKey(db, userId, args.id);
      if (!key) throw notFound('Unknown API key');
      await renameKey(db, userId, key.id, name);
      return toGraphql({ ...key, name });
    },
    // True when the key was revoked. Only a hash is stored, so deleting the
    // row is the revocation — whatever holds the key is refused on its next
    // request, over /graphql and /mcp alike.
    revokeApiKey: async (_source, args, ctx) => {
      const userId = requireUser(ctx);
      const key = await findIntegrationKey(db, userId, args.id);
      if (!key) throw notFound('Unknown API key');
      await deleteKey(db, userId, key.id);
      return true;
    },
  } satisfies Pick<MutationResolvers, 'createApiKey' | 'renameApiKey' | 'revokeApiKey'>;
}
