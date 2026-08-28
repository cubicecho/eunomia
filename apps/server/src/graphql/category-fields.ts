import type { MutationResolvers } from '@eunomia/gql/resolvers';
import { eq } from 'drizzle-orm';
import { mergeCategorySummaries, moveRolledSeconds } from '../activity/rollup.ts';
import type { Db } from '../db/client.ts';
import { activities, categories, devices } from '../db/schema.ts';
import { notFound } from '../errors.ts';
import { requireOwned, requireUser } from './guards.ts';

// Categories and the one mutation that moves an activity between them by hand.

export function categoryFields(db: Db) {
  return {
    createCategory: async (_source, args, ctx) => {
      const userId = requireUser(ctx);
      const [row] = await db
        .insert(categories)
        .values({
          id: crypto.randomUUID(),
          userId,
          name: args.name,
          color: args.color ?? null,
        })
        .returning();
      return row!;
    },
    // True when a category was deleted. Assigned activities are kept and
    // unassigned (FK set-null), never deleted with the bucket.
    deleteCategory: async (_source, args, ctx) => {
      const userId = requireUser(ctx);
      const category = await requireOwned(db, categories, args.id, userId, 'Unknown category');
      // Summary rows can't ride the FK's set-null (it would collide with
      // existing uncategorized rows) — merge them first.
      await mergeCategorySummaries(db, category.id);
      await db.delete(categories).where(eq(categories.id, category.id));
      return true;
    },
    // Sets (or, with a null categoryId, clears) an activity's category.
    assignActivity: async (_source, args, ctx) => {
      const userId = requireUser(ctx);
      // Activities carry no userId of their own, so requireOwned can't fence
      // this one: ownership runs through the device (activity -> device ->
      // user) and needs the join.
      const [found] = await db
        .select({ activity: activities, ownerId: devices.userId })
        .from(activities)
        .innerJoin(devices, eq(activities.deviceId, devices.id))
        .where(eq(activities.id, args.activityId))
        .limit(1);
      if (!found || found.ownerId !== userId) throw notFound('Unknown activity');
      if (args.categoryId != null) {
        await requireOwned(db, categories, args.categoryId, userId, 'Unknown category');
      }
      // Manual assignment pins the choice against rules; clearing returns
      // the row to the auto-categorization pool.
      const [updated] = await db
        .update(activities)
        .set({
          categoryId: args.categoryId ?? null,
          categorySource: args.categoryId != null ? 'manual' : null,
        })
        .where(eq(activities.id, args.activityId))
        .returning();
      // If the activity's seconds are already summarized, carry them over.
      await moveRolledSeconds(
        db,
        found.activity,
        found.activity.categoryId,
        args.categoryId ?? null,
      );
      return updated!;
    },
  } satisfies MutationResolvers;
}
