import { and, eq, type InferSelectModel } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import type { Db } from '../db/client.ts';
import { notFound, unauthenticated } from '../errors.ts';
import type { Context } from './context.ts';

// The two fences every domain resolver stands behind. They were 18 and 14
// copies of a two-line idiom before this file existed, which made "did this
// resolver remember its check?" a question you answered by reading it.

/**
 * The caller's user id, or a thrown UNAUTHENTICATED.
 *
 * The permissions layer already blocks anonymous calls to every field that
 * uses this, so in practice it never throws — what it earns its place for is
 * narrowing `string | undefined` to `string` at the top of a resolver, which
 * is why it returns the id rather than asserting.
 */
export function requireUser(ctx: Context): string {
  if (!ctx.userId) throw unauthenticated();
  return ctx.userId;
}

/** A table this helper can fence: one row per id, each owned by a user. */
type OwnedTable = PgTable & { id: PgColumn; userId: PgColumn };

/**
 * Loads a row the caller owns, or throws NOT_FOUND.
 *
 * Ownership is part of the WHERE rather than a comparison on the loaded row,
 * so "someone else's id" and "no such id" are one query and one answer — which
 * is also the only answer we want to give, since telling them apart leaks
 * whether another user has that id.
 *
 * `label` is the message ('Unknown device'), not the code; clients branch on
 * extensions.code.
 */
export async function requireOwned<T extends OwnedTable>(
  db: Db,
  table: T,
  id: string,
  userId: string,
  label: string,
): Promise<InferSelectModel<T>> {
  const [row] = await db
    // The generic loses drizzle's row inference, so the select is untyped here
    // and re-typed on the way out — the one cast this helper exists to make
    // once instead of fourteen times.
    .select()
    .from(table as PgTable)
    .where(and(eq(table.id, id), eq(table.userId, userId)))
    .limit(1);
  if (!row) throw notFound(label);
  return row as InferSelectModel<T>;
}
