import { graphql } from 'graphql';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  assertValidContextPattern,
  type ContextRule,
  extractContext,
} from '../src/activity/context.ts';
import { devices, user } from '../src/db/schema.ts';
import type { Context } from '../src/graphql/context.ts';
import { createSchema } from '../src/graphql/schema.ts';
import { stubAuthGateway } from './helpers/stub-auth.ts';
import { createMigratedTestDb } from './helpers/test-db.ts';

const rule = (overrides: Partial<ContextRule>): ContextRule => ({
  id: 'r',
  userId: 'user-1',
  appPattern: null,
  titlePattern: '(.+)',
  priority: 0,
  createdAt: new Date(0),
  ...overrides,
});

describe('extractContext', () => {
  it('returns the trimmed first capture of the first matching rule', () => {
    const rules = [rule({ titlePattern: '^(.+?)\\s*- novelWriter$' })];
    expect(extractContext(rules, 'novelwriter', 'My Book - novelWriter')).toBe('My Book');
    expect(extractContext(rules, 'novelwriter', 'unrelated title')).toBeNull();
  });

  it('narrows by appPattern when present', () => {
    const rules = [rule({ appPattern: '^ableton', titlePattern: '^(.+?)\\*?\\s+- Ableton Live' })];
    expect(extractContext(rules, 'ableton live 12', 'My Song* - Ableton Live 12')).toBe('My Song');
    expect(extractContext(rules, 'code', 'My Song* - Ableton Live 12')).toBeNull();
    expect(extractContext(rules, null, 'My Song* - Ableton Live 12')).toBeNull();
  });

  it('respects rule order and skips empty captures', () => {
    const rules = [
      rule({ id: 'a', titlePattern: '^\\[(.*)\\]' }), // may capture empty
      rule({ id: 'b', titlePattern: '— (.+?) — Visual Studio Code' }),
    ];
    expect(extractContext(rules, 'code', '[] — eunomia — Visual Studio Code')).toBe('eunomia');
    expect(extractContext(rules, 'code', '[proj] anything')).toBe('proj');
  });

  it('never matches a titleless ping and survives invalid stored patterns', () => {
    expect(extractContext([rule({})], 'code', null)).toBeNull();
    expect(extractContext([rule({ titlePattern: '(' })], 'code', 'anything')).toBeNull();
  });
});

describe('assertValidContextPattern', () => {
  it('accepts a valid regex with a capture group', () => {
    expect(() => assertValidContextPattern('^(.+) - novelWriter$')).not.toThrow();
  });

  it('rejects invalid regexes and patterns without a capture group', () => {
    expect(() => assertValidContextPattern('(')).toThrow(/Invalid pattern/);
    expect(() => assertValidContextPattern('novelWriter')).toThrow(/capture group/);
    // Non-capturing groups don't count.
    expect(() => assertValidContextPattern('(?:a|b)')).toThrow(/capture group/);
  });
});

describe('context over GraphQL', () => {
  let db: Awaited<ReturnType<typeof createMigratedTestDb>>;
  let schema: ReturnType<typeof createSchema>;

  const asUser = (userId: string): Context =>
    ({ db, userId, deviceId: 'device-1', headers: new Headers() }) as Context;

  const run = (source: string, userId = 'user-1') =>
    graphql({ schema, source, contextValue: asUser(userId) });

  const data = async (source: string, userId = 'user-1') => {
    const result = await run(source, userId);
    expect(result.errors).toBeUndefined();
    // biome-ignore lint/suspicious/noExplicitAny: test convenience
    return result.data as any;
  };

  beforeEach(async () => {
    db = await createMigratedTestDb();
    schema = createSchema(db as never, stubAuthGateway());
    await db.insert(user).values([
      { id: 'user-1', name: 'u', email: 'u@example.com' },
      { id: 'user-2', name: 'v', email: 'v@example.com' },
    ]);
    await db
      .insert(devices)
      .values({ id: 'device-1', userId: 'user-1', name: 'laptop', platform: 'linux' });
  });

  const ping = (
    seconds: number,
    fields: string,
  ): Promise<{ recordPing: { id: string; context: string | null; categoryId: string | null } }> =>
    data(`mutation { recordPing(
      capturedAt: "2026-08-17T12:00:${String(seconds).padStart(2, '0')}.000Z",
      ${fields}, idleSeconds: 0
    ) { id context categoryId } }`);

  it('uses an agent-supplied context verbatim, splitting rows within an app', async () => {
    const gmail = await ping(0, 'app: "firefox", title: "Inbox", context: "mail.google.com"');
    const tube = await ping(10, 'app: "firefox", title: "Cats", context: "youtube.com"');
    expect(gmail.recordPing.context).toBe('mail.google.com');
    expect(tube.recordPing.context).toBe('youtube.com');
    expect(gmail.recordPing.id).not.toBe(tube.recordPing.id);
  });

  it('extracts context from the title via the user rules when the agent sends none', async () => {
    await data(`mutation { createContextRule(
      appPattern: "^novelwriter$", titlePattern: "^(.+?) - novelWriter$"
    ) { id } }`);

    const book = await ping(0, 'app: "novelwriter", title: "My Book - novelWriter"');
    expect(book.recordPing.context).toBe('My Book');

    // Different book = different row; unmatched app folds contextless.
    const other = await ping(10, 'app: "novelwriter", title: "Sequel - novelWriter"');
    expect(other.recordPing.context).toBe('Sequel');
    expect(other.recordPing.id).not.toBe(book.recordPing.id);
    const code = await ping(20, 'app: "code", title: "whatever"');
    expect(code.recordPing.context).toBeNull();
  });

  it('rejects context rules without a capture group or with a bad regex', async () => {
    const bad = await run('mutation { createContextRule(titlePattern: "no capture") { id } }');
    expect(bad.errors?.[0]?.message).toMatch(/capture group/);
    const invalid = await run('mutation { createContextRule(titlePattern: "(") { id } }');
    expect(invalid.errors?.[0]?.message).toMatch(/Invalid pattern/);
  });

  it('scopes contextRules to their owner and checks delete ownership', async () => {
    const created = await data(
      'mutation { createContextRule(titlePattern: "(.+) - novelWriter") { id } }',
    );
    const mine = await data('{ contextRules { id } }');
    expect(mine.contextRules).toHaveLength(1);
    const theirs = await data('{ contextRules { id } }', 'user-2');
    expect(theirs.contextRules).toHaveLength(0);

    const denied = await run(
      `mutation { deleteContextRule(id: "${created.createContextRule.id}") }`,
      'user-2',
    );
    expect(denied.errors?.[0]?.message).toMatch(/Unknown rule/);
    const deleted = await data(
      `mutation { deleteContextRule(id: "${created.createContextRule.id}") }`,
    );
    expect(deleted.deleteContextRule).toBe(true);
  });

  it('categorizes by contextPattern', async () => {
    const category = await data('mutation { createCategory(name: "Distraction") { id } }');
    await data(`mutation { createCategoryRule(
      categoryId: "${category.createCategory.id}", contextPattern: "youtube\\\\.com"
    ) { id } }`);

    const tube = await ping(0, 'app: "firefox", title: "Cats", context: "youtube.com"');
    expect(tube.recordPing.categoryId).toBe(category.createCategory.id);
    // A context pattern never matches a contextless row.
    const plain = await ping(10, 'app: "firefox", title: "youtube.com everywhere"');
    expect(plain.recordPing.categoryId).toBeNull();
  });
});
