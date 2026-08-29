import { graphql } from 'graphql';
import { beforeEach, describe, expect, it } from 'vitest';
import { createAuth, createAuthGateway, verifyApiKey } from '../src/auth.ts';
import { user } from '../src/db/schema.ts';
import type { Context } from '../src/graphql/context.ts';
import { createSchema } from '../src/graphql/schema.ts';
import { createMigratedTestDb } from './helpers/test-db.ts';

// Integration keys: what the dashboard issues so another app can talk to this
// server. Real better-auth here rather than the stub gateway — the point of
// most of these is that the key the mutation hands back actually
// authenticates, which a stub cannot tell you.

describe('integration keys', () => {
  let db: Awaited<ReturnType<typeof createMigratedTestDb>>;
  let auth: ReturnType<typeof createAuth>;
  let schema: ReturnType<typeof createSchema>;

  /** A signed-in dashboard user: userId, no key. */
  const asSession = (userId: string | undefined): Context =>
    ({ db, userId, keyId: undefined, deviceId: undefined, headers: new Headers() }) as Context;

  /** The same user, but reached through one of their API keys. */
  const asKey = (userId: string, keyId: string, deviceId?: string): Context =>
    ({ db, userId, keyId, deviceId, headers: new Headers() }) as Context;

  const run = (source: string, contextValue: Context) => graphql({ schema, source, contextValue });

  const data = async (source: string, contextValue: Context) => {
    const result = await run(source, contextValue);
    expect(result.errors).toBeUndefined();
    return result.data as any;
  };

  const create = (name: string, expiresInDays?: number) =>
    data(
      `mutation {
        createApiKey(name: ${JSON.stringify(name)}${
          expiresInDays === undefined ? '' : `, expiresInDays: ${expiresInDays}`
        }) {
          token
          key { id name start createdAt lastUsedAt expiresAt enabled }
        }
      }`,
      asSession('user-1'),
    ).then((result) => result.createApiKey);

  const list = (contextValue: Context = asSession('user-1')) =>
    data('{ apiKeys { id name start expiresAt enabled } }', contextValue).then(
      (result) => result.apiKeys,
    );

  beforeEach(async () => {
    db = await createMigratedTestDb();
    auth = createAuth(db as never, {
      secret: 'test-secret-test-secret-test-secret',
      baseURL: 'http://localhost:4000',
    });
    schema = createSchema(db as never, createAuthGateway(auth, db as never));
    await db.insert(user).values([
      { id: 'user-1', name: 'u', email: 'u@example.com' },
      { id: 'user-2', name: 'v', email: 'v@example.com' },
    ]);
  });

  it('issues a working key and returns the secret exactly once', async () => {
    const issued = await create('mcp client');

    expect(issued.key.name).toBe('mcp client');
    expect(issued.key.enabled).toBe(true);
    expect(issued.key.expiresAt).toBeNull();
    expect(issued.key.lastUsedAt).toBeNull();
    expect(issued.token).toEqual(expect.any(String));
    expect(issued.token.length).toBeGreaterThan(20);

    // It authenticates as its owner, and as nothing more: no device.
    expect(await verifyApiKey(auth, issued.token)).toEqual({
      userId: 'user-1',
      keyId: issued.key.id,
      deviceId: undefined,
    });

    // The list that follows knows about the key but not what it is.
    const listed = await list();
    expect(listed).toEqual([expect.objectContaining({ id: issued.key.id, name: 'mcp client' })]);
    expect(JSON.stringify(listed)).not.toContain(issued.token);
    // `start` is the few leading characters kept so two keys can be told apart.
    expect(issued.token.startsWith(listed[0].start)).toBe(true);
  });

  it('honours an expiry, in days, within better-auth’s bounds', async () => {
    const issued = await create('a fortnight', 14);

    const expiresAt = new Date(issued.key.expiresAt).getTime();
    const expected = Date.now() + 14 * 24 * 60 * 60 * 1000;
    expect(Math.abs(expiresAt - expected)).toBeLessThan(60_000);

    for (const days of [0, 400]) {
      const result = await run(
        `mutation { createApiKey(name: "x", expiresInDays: ${days}) { token } }`,
        asSession('user-1'),
      );
      expect(result.errors?.[0]?.extensions?.code).toBe('BAD_USER_INPUT');
    }
  });

  it('lists only the caller’s own keys', async () => {
    const mine = await create('mine');
    await data('mutation { createApiKey(name: "theirs") { key { id } } }', asSession('user-2'));

    expect(await list()).toEqual([expect.objectContaining({ id: mine.key.id })]);
    expect(await list(asSession('user-2'))).toEqual([expect.objectContaining({ name: 'theirs' })]);
  });

  it('leaves device keys to the Devices tab', async () => {
    const registered = await data(
      'mutation { registerDevice(name: "laptop", platform: "linux") { apiKey device { id } } }',
      asSession('user-1'),
    );
    const integration = await create('mcp client');

    // Both are rows in the same table; only the device-less one is an
    // integration, so only it is listed and only it is revocable here.
    expect(await list()).toEqual([expect.objectContaining({ id: integration.key.id })]);

    const result = await run(
      `mutation { revokeApiKey(id: ${JSON.stringify(registered.registerDevice.device.id)}) }`,
      asSession('user-1'),
    );
    expect(result.errors?.[0]?.extensions?.code).toBe('NOT_FOUND');
    expect(await verifyApiKey(auth, registered.registerDevice.apiKey)).not.toBeNull();
  });

  it('renames a key without reissuing it', async () => {
    const issued = await create('temp name');

    const renamed = await data(
      `mutation { renameApiKey(id: ${JSON.stringify(issued.key.id)}, name: " CI ") { id name } }`,
      asSession('user-1'),
    );
    expect(renamed.renameApiKey).toEqual({ id: issued.key.id, name: 'CI' });
    expect(await list()).toEqual([expect.objectContaining({ name: 'CI' })]);
    // Same credential throughout — renaming is not rotation.
    expect(await verifyApiKey(auth, issued.token)).not.toBeNull();
  });

  it('revoking a key stops it authenticating', async () => {
    const issued = await create('leaked');

    expect(
      (
        await data(
          `mutation { revokeApiKey(id: ${JSON.stringify(issued.key.id)}) }`,
          asSession('user-1'),
        )
      ).revokeApiKey,
    ).toBe(true);

    expect(await verifyApiKey(auth, issued.token)).toBeNull();
    expect(await list()).toEqual([]);
  });

  it('refuses to reveal or revoke another user’s key', async () => {
    const mine = await create('mine');

    for (const source of [
      `mutation { revokeApiKey(id: ${JSON.stringify(mine.key.id)}) }`,
      `mutation { renameApiKey(id: ${JSON.stringify(mine.key.id)}, name: "yours") { id } }`,
    ]) {
      const result = await run(source, asSession('user-2'));
      // NOT_FOUND rather than a refusal: telling them apart would confirm the id exists.
      expect(result.errors?.[0]?.extensions?.code).toBe('NOT_FOUND');
    }
    expect(await verifyApiKey(auth, mine.token)).not.toBeNull();
  });

  it('does not let a key manage keys', async () => {
    const issued = await create('leaked');
    const holder = asKey('user-1', issued.key.id);

    // A key that could mint a successor would outlive being revoked, so key
    // management is the one thing a signed-in session can do that a key cannot
    // — even though both authenticate as the same user.
    for (const source of [
      '{ apiKeys { id } }',
      'mutation { createApiKey(name: "successor") { token } }',
      `mutation { renameApiKey(id: ${JSON.stringify(issued.key.id)}, name: "x") { id } }`,
      `mutation { revokeApiKey(id: ${JSON.stringify(issued.key.id)}) }`,
    ]) {
      const result = await run(source, holder);
      expect(result.errors?.[0]?.extensions?.code).toBe('UNAUTHENTICATED');
    }

    // A device key is refused for the same reason.
    const device = asKey('user-1', 'device-key-id', 'device-1');
    expect((await run('{ apiKeys { id } }', device)).errors?.[0]?.extensions?.code).toBe(
      'UNAUTHENTICATED',
    );

    // What the key IS for still works: it reads the owner's data.
    expect((await run('{ devices { id } }', holder)).errors).toBeUndefined();
  });

  it('refuses anonymous callers and unnamed keys', async () => {
    expect(
      (await run('{ apiKeys { id } }', asSession(undefined))).errors?.[0]?.extensions?.code,
    ).toBe('UNAUTHENTICATED');

    const unnamed = await run(
      'mutation { createApiKey(name: "  ") { token } }',
      asSession('user-1'),
    );
    expect(unnamed.errors?.[0]?.extensions?.code).toBe('BAD_USER_INPUT');
    expect(await list()).toEqual([]);
  });
});
