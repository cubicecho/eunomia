import { eq } from 'drizzle-orm';
import { graphql } from 'graphql';
import { beforeEach, describe, expect, it } from 'vitest';
import { packRules, RULE_PACKS } from '../src/activity/rule-packs.ts';
import { type CategoryRule, matchRule } from '../src/activity/rules.ts';
import { categoryRules, devices, user } from '../src/db/schema.ts';
import type { Context } from '../src/graphql/context.ts';
import { createSchema } from '../src/graphql/schema.ts';
import { stubAuthGateway } from './helpers/stub-auth.ts';
import { createMigratedTestDb } from './helpers/test-db.ts';

describe('starter rule packs', () => {
  describe('the catalogue', () => {
    // A pack's rules as the matcher sees them, one pack's worth at a time.
    const rulesOf = (id: string): CategoryRule[] =>
      packRules(RULE_PACKS.find((pack) => pack.id === id)!).map((rule, i) => ({
        ...rule,
        id: rule.pack,
        userId: 'user-1',
        categoryId: id,
        priority: 0,
        createdAt: new Date(i),
        packVersion: 1,
      }));
    const all = RULE_PACKS.flatMap((pack) => rulesOf(pack.id));
    const packOf = (app: string, title: string | null = null, context: string | null = null) =>
      matchRule(all, app, title, context)?.categoryId ?? null;

    it('matches what the agents actually report', () => {
      // Desktop: the executable name on Linux, its stem on Windows, the
      // bundle on macOS.
      expect(packOf('code')).toBe('development');
      expect(packOf('Code')).toBe('development');
      expect(packOf('Visual Studio Code.app')).toBe('development');
      expect(packOf('WINWORD')).toBe('productivity');
      expect(packOf('soffice.bin')).toBe('productivity');
      expect(packOf('steamwebhelper')).toBe('gaming');
      expect(packOf('zoom.us.app')).toBe('communication');
      // Android: the launcher label, with the package as the title — or the
      // package as the app, when the label didn't resolve.
      expect(packOf('YouTube', 'com.google.android.youtube')).toBe('entertainment');
      expect(packOf('YouTube')).toBe('entertainment');
      expect(packOf('com.google.android.youtube')).toBe('entertainment');
      // A translated label still lands through its package.
      expect(packOf('Mensajes', 'com.google.android.apps.messaging')).toBe('messaging');
      // Browsers: the hostname, www. or not.
      expect(packOf('firefox', 'r/programming', 'www.reddit.com')).toBe('social');
      expect(packOf('chrome', 'Pull requests', 'github.com')).toBe('development');
    });

    it('matches exact values, never fragments', () => {
      // `code` must not claim every app with "code" in its name, nor a site
      // every host that merely contains one of its hosts.
      expect(packOf('vscode-helper')).toBeNull();
      expect(packOf('Xcoder')).toBeNull();
      expect(packOf('firefox', null, 'notreddit.com')).toBeNull();
      expect(packOf('firefox', null, 'github.com.evil.example')).toBeNull();
      // The browser itself stays uncategorized off a pack's sites.
      expect(packOf('firefox', null, 'example.com')).toBeNull();
    });

    it('lists every value in exactly one pack', () => {
      // Two packs claiming one app would make the result depend on install
      // order. Rules are case-insensitive, so the check is too.
      const seen = new Map<string, string>();
      for (const pack of RULE_PACKS) {
        for (const [list, values] of Object.entries({
          apps: pack.apps,
          packages: pack.packages,
          sites: pack.sites,
        })) {
          for (const value of values) {
            const key = `${list === 'sites' ? 'site' : 'app'}:${value.toLowerCase()}`;
            expect(seen.get(key), `${value} in ${pack.id} and ${seen.get(key)}`).toBeUndefined();
            seen.set(key, pack.id);
          }
        }
      }
      // And a package is never also a label somewhere, since both go in the
      // app rule.
      for (const pack of RULE_PACKS) {
        for (const pkg of pack.packages) expect(seen.get(`app:${pkg.toLowerCase()}`)).toBe(pack.id);
      }
    });

    it('writes lists the rules page reads back as "is one of"', () => {
      // No commas (the editor's separator) and no surrounding whitespace.
      for (const pack of RULE_PACKS) {
        for (const value of [...pack.apps, ...pack.packages, ...pack.sites]) {
          expect(value).not.toMatch(/,|^\s|\s$/);
        }
        for (const value of pack.sites) expect(value).toBe(value.toLowerCase());
      }
      expect(new Set(RULE_PACKS.map((pack) => pack.id)).size).toBe(RULE_PACKS.length);
      expect(new Set(RULE_PACKS.map((pack) => pack.category.name)).size).toBe(RULE_PACKS.length);
    });
  });

  describe('installing', () => {
    let db: Awaited<ReturnType<typeof createMigratedTestDb>>;
    let schema: ReturnType<typeof createSchema>;

    const asUser = (userId: string): Context =>
      ({ db, userId, deviceId: 'device-1', keyId: undefined, headers: new Headers() }) as Context;

    const data = async (source: string, userId = 'user-1') => {
      const result = await graphql({ schema, source, contextValue: asUser(userId) });
      expect(result.errors).toBeUndefined();
      return result.data as any;
    };

    const install = async (id: string, userId = 'user-1') =>
      (
        await data(
          `mutation { installRulePack(id: "${id}") {
            categoryId added updated categorized pack { id installedVersion }
          } }`,
          userId,
        )
      ).installRulePack;

    const rules = async (userId = 'user-1') =>
      db.select().from(categoryRules).where(eq(categoryRules.userId, userId));

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

    it('creates the category and its rules, and is idempotent', async () => {
      const first = await install('development');
      expect(first).toMatchObject({ added: 3, updated: 0, pack: { installedVersion: 1 } });
      const { categories } = await data('{ categories { id name color kind } }');
      expect(categories).toEqual([
        { id: first.categoryId, name: 'Development', color: '#3987e5', kind: 'focus' },
      ]);

      const second = await install('development');
      expect(second).toMatchObject({ categoryId: first.categoryId, added: 0, updated: 0 });
      expect(await rules()).toHaveLength(3);
      expect((await data('{ categories { id } }')).categories).toHaveLength(1);
    });

    it('reuses a category of the same name', async () => {
      const { createCategory } = await data(
        'mutation { createCategory(name: "Social", color: "#000") { id } }',
      );
      const result = await install('social');
      expect(result.categoryId).toBe(createCategory.id);
      // Still the user's own color and kind.
      expect((await data('{ categories { color kind } }')).categories).toEqual([
        { color: '#000', kind: 'neutral' },
      ]);
    });

    it('leaves an edited rule alone, and restores a deleted one', async () => {
      const { categoryId } = await install('gaming');
      const tagged = await rules();
      const apps = tagged.find((rule) => rule.pack === 'gaming/apps');
      const sites = tagged.find((rule) => rule.pack === 'gaming/sites');
      await data(`mutation { updateCategoryRule(
        id: "${apps!.id}", categoryId: "${categoryId}", appPattern: "^steam$"
      ) { id } }`);
      await data(`mutation { deleteCategoryRule(id: "${sites!.id}") }`);

      expect(await install('gaming')).toMatchObject({ added: 1, updated: 0 });
      const after = await rules();
      expect(after).toHaveLength(3);
      expect(after.find((rule) => rule.id === apps!.id)?.appPattern).toBe('^steam$');
    });

    it('follows its rules into the category they were moved to', async () => {
      const { categoryId } = await install('entertainment');
      const { createCategory } = await data('mutation { createCategory(name: "Fun") { id } }');
      for (const rule of await rules()) {
        await db
          .update(categoryRules)
          .set({ categoryId: createCategory.id })
          .where(eq(categoryRules.id, rule.id));
      }
      await data(`mutation { deleteCategory(id: "${categoryId}") }`);
      expect(await install('entertainment')).toMatchObject({
        categoryId: createCategory.id,
        added: 0,
      });
      expect((await data('{ categories { name } }')).categories).toEqual([{ name: 'Fun' }]);
    });

    it('upgrades rules an older version wrote', async () => {
      await install('messaging');
      await db.update(categoryRules).set({ packVersion: 0, appPattern: '^old$' });
      expect(await install('messaging')).toMatchObject({ added: 0, updated: 3 });
      const apps = (await rules()).find((rule) => rule.pack === 'messaging/apps');
      expect(apps).toMatchObject({ packVersion: 1 });
      expect(apps?.appPattern).toContain('signal-desktop');
    });

    it('adopts an identical rule rather than writing its twin', async () => {
      // Say, a pack rule that came back untagged from an account bundle.
      const pack = RULE_PACKS.find((p) => p.id === 'communication')!;
      const [appsRule] = packRules(pack);
      const { createCategory } = await data(
        'mutation { createCategory(name: "Communication") { id } }',
      );
      await db.insert(categoryRules).values({
        id: 'restored',
        userId: 'user-1',
        categoryId: createCategory.id,
        appPattern: appsRule!.appPattern,
      });
      expect(await install('communication')).toMatchObject({ added: 2 });
      const after = await rules();
      expect(after).toHaveLength(3);
      expect(after.find((rule) => rule.id === 'restored')?.pack).toBe('communication/apps');
    });

    it('categorizes the uncategorized time already recorded', async () => {
      const ping = (second: number, app: string, title?: string, context?: string) =>
        data(`mutation { recordPing(
          capturedAt: "2026-08-17T12:00:${String(second).padStart(2, '0')}.000Z", app: "${app}",
          ${title ? `title: "${title}",` : ''} ${context ? `context: "${context}",` : ''} idleSeconds: 0
        ) { id } }`);
      await ping(0, 'Discord');
      await ping(10, 'firefox', 'Home', 'www.reddit.com');
      await ping(20, 'Notes');

      const { categorized, categoryId } = await install('social');
      expect(categorized).toBe(2);
      const { activities } = await data('{ activities { app categoryId categorySource } }');
      expect(activities).toEqual(
        expect.arrayContaining([
          { app: 'Discord', categoryId, categorySource: 'rule' },
          { app: 'firefox', categoryId, categorySource: 'rule' },
          { app: 'Notes', categoryId: null, categorySource: null },
        ]),
      );
    });

    it('reports what each user has installed, separately', async () => {
      await install('development', 'user-2');
      const packs = async (userId: string) =>
        (await data('{ rulePacks { id installedVersion } }', userId)).rulePacks as {
          id: string;
          installedVersion: number | null;
        }[];
      expect((await packs('user-1')).every((p) => p.installedVersion === null)).toBe(true);
      expect((await packs('user-2')).find((p) => p.id === 'development')?.installedVersion).toBe(1);
      expect(await rules('user-1')).toEqual([]);
    });

    it('refuses an unknown pack', async () => {
      const result = await graphql({
        schema,
        source: 'mutation { installRulePack(id: "nope") { categoryId } }',
        contextValue: asUser('user-1'),
      });
      expect(result.errors?.[0]?.message).toBe('Unknown rule pack');
    });
  });
});
