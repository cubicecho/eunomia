import type { MutationCreateCategoryArgs, MutationResolvers } from '@eunomia/gql/resolvers';
import { and, eq, inArray, isNull, ne } from 'drizzle-orm';
import { entryMatch, ownDeviceIds } from '../activity/merge-rules.ts';
import {
  addSeconds,
  mergeCategorySummaries,
  moveRolledSeconds,
  ownerJoin,
} from '../activity/rollup.ts';
import type { Db } from '../db/client.ts';
import { activities, categories, devices, summaries, user } from '../db/schema.ts';
import { badInput, notFound } from '../errors.ts';
import { requireOwned, requireUser } from './guards.ts';
import { liveDayBounds, parseRange, summaryDayBounds } from './summaries.ts';

// Categories, and the two mutations that move time between them by hand.

/**
 * The written columns, shared by create and update, validated the same way for
 * both.
 *
 * The name check is the unique index (categories_user_name_idx) asked first:
 * left to the index, a duplicate is a constraint violation, which reaches the
 * client masked as "Unexpected error." rather than as something to fix.
 * `exceptId` is the category being renamed, which may keep its own name.
 */
async function categoryValues(
  db: Db,
  userId: string,
  args: MutationCreateCategoryArgs,
  exceptId?: string,
) {
  const name = args.name.trim();
  if (!name) throw badInput('A category needs a name');
  const [clash] = await db
    .select({ id: categories.id })
    .from(categories)
    .where(
      and(
        eq(categories.userId, userId),
        eq(categories.name, name),
        exceptId ? ne(categories.id, exceptId) : undefined,
      ),
    )
    .limit(1);
  if (clash) throw badInput(`There is already a category called “${name}”`);
  // A blank color is no color: the charts fall back to a stable palette slot.
  const color = args.color?.trim();
  return { name, color: color ? color : null };
}

export function categoryFields(db: Db) {
  return {
    createCategory: async (_source, args, ctx) => {
      const userId = requireUser(ctx);
      const [row] = await db
        .insert(categories)
        .values({ id: crypto.randomUUID(), userId, ...(await categoryValues(db, userId, args)) })
        .returning();
      return row!;
    },
    // Rename and recolor. Nothing else refers to a category by name — rules,
    // activities and summaries all hold its id — so this touches one row.
    updateCategory: async (_source, args, ctx) => {
      const userId = requireUser(ctx);
      const category = await requireOwned(db, categories, args.id, userId, 'Unknown category');
      const [row] = await db
        .update(categories)
        .set(await categoryValues(db, userId, args, category.id))
        .where(eq(categories.id, category.id))
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
    // The review queue's "assign": an entry's uncategorized time over a window,
    // i.e. exactly what one of appSummary's uncategorized rows showed.
    //
    // Per entry rather than per activity because that is the unit the queue
    // lists, and walking assignActivity over each row would miss the seconds
    // that only exist in summaries now (raw activities pruned past retention).
    // Only uncategorized time moves: an entry split between Work and nothing
    // keeps its Work.
    assignEntry: async (_source, args, ctx) => {
      const userId = requireUser(ctx);
      const category = await requireOwned(
        db,
        categories,
        args.categoryId,
        userId,
        'Unknown category',
      );
      const { from, to } = parseRange(args);
      const deviceIds = await ownDeviceIds(db, userId);
      if (deviceIds.length === 0) return 0;
      const entry = { app: args.app, context: args.context ?? null };

      return db.transaction(async (tx) => {
        // Rolled seconds move summary row by summary row, the way a merge
        // moves them: an uncategorized row for this entry is exactly the
        // uncategorized activities that rolled into it, so the whole row goes.
        // Added into the category's row and dropped, since updating the key in
        // place would collide with that row under summaries_key_idx.
        const rolled = await tx
          .select()
          .from(summaries)
          .where(
            and(
              entryMatch(summaries.deviceId, summaries.app, summaries.context, deviceIds, entry),
              isNull(summaries.categoryId),
              ...summaryDayBounds(from, to),
            ),
          );
        let seconds = 0;
        for (const row of rolled) {
          await addSeconds(
            tx,
            {
              deviceId: row.deviceId,
              day: row.day,
              app: row.app,
              context: row.context,
              categoryId: category.id,
            },
            row.seconds,
          );
          await tx.delete(summaries).where(eq(summaries.id, row.id));
          seconds += row.seconds;
        }

        // Then the raw rows, relabelled in place. Their rolled seconds were
        // just carried above, so there is no moveRolledSeconds here — it would
        // move them twice. Matched on categoryId alone: a category deleted out
        // from under a manual assignment leaves categorySource behind, and that
        // time is as uncategorized as any. The window is the owner's days, which
        // reads their zone through a join an UPDATE can't take — hence the
        // subquery.
        const inWindow = tx
          .select({ id: activities.id })
          .from(activities)
          .innerJoin(devices, ownerJoin.device)
          .innerJoin(user, ownerJoin.user)
          .where(
            and(
              entryMatch(activities.deviceId, activities.app, activities.context, deviceIds, entry),
              isNull(activities.categoryId),
              ...liveDayBounds(from, to),
            ),
          );
        const assigned = await tx
          .update(activities)
          .set({ categoryId: category.id, categorySource: 'manual' })
          .where(inArray(activities.id, inWindow))
          .returning({ activeSeconds: activities.activeSeconds, rolledUp: activities.rolledUp });
        for (const row of assigned) {
          if (!row.rolledUp) seconds += row.activeSeconds;
        }
        return seconds;
      });
    },
  } satisfies MutationResolvers;
}
