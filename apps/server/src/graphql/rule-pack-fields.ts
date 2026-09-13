import type { MutationResolvers, QueryResolvers } from '@eunomia/gql/resolvers';
import {
  installedPackVersions,
  installRulePack,
  RULE_PACKS,
  type RulePack,
} from '../activity/rule-packs.ts';
import type { Db } from '../db/client.ts';
import { requireUser } from './guards.ts';

// Starter rule packs (src/activity/rule-packs.ts): the catalogue, and
// installing from it. The rules an install writes are read, edited and deleted
// through the ordinary categoryRules fields — a pack only writes them.

/** A pack as the API shows it to one user. */
const packOut = (pack: RulePack, installedVersion: number | undefined) => ({
  id: pack.id,
  name: pack.name,
  description: pack.description,
  version: pack.version,
  categoryName: pack.category.name,
  apps: pack.apps,
  packages: pack.packages,
  sites: pack.sites,
  installedVersion: installedVersion ?? null,
});

export function rulePackQueryFields(db: Db) {
  return {
    rulePacks: async (_source, _args, ctx) => {
      const installed = await installedPackVersions(db, requireUser(ctx));
      return RULE_PACKS.map((pack) => packOut(pack, installed.get(pack.id)));
    },
  } satisfies QueryResolvers;
}

export function rulePackFields(db: Db) {
  return {
    installRulePack: async (_source, args, ctx) => {
      const userId = requireUser(ctx);
      const install = await installRulePack(db, userId, args.id);
      const installed = await installedPackVersions(db, userId);
      return { ...install, pack: packOut(install.pack, installed.get(install.pack.id)) };
    },
  } satisfies MutationResolvers;
}
