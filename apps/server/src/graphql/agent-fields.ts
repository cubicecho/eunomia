import type { QueryResolvers } from '@eunomia/gql/resolvers';
import { and, desc, eq, ilike, or, type SQL, sql } from 'drizzle-orm';
import { ownerJoin, ownerZone } from '../activity/rollup.ts';
import { assertValidPattern, type CategoryRule, matchRule } from '../activity/rules.ts';
import type { Db } from '../db/client.ts';
import { activities, categories, devices, user } from '../db/schema.ts';
import { badInput } from '../errors.ts';
import type { Context } from './context.ts';
import { requireUser } from './guards.ts';
import { isCalendarDay, liveDayBounds, parseRange, summaryFields } from './summaries.ts';

// Reads shaped for an assistant rather than a dashboard (issue #40): each
// answers in one call what the dashboard assembles from several aggregates,
// with the date arithmetic done here, in the caller's time zone, where the
// assistant can't get it wrong. They reuse the dashboard's own resolvers, so
// the seconds are the same seconds.

/** Today, `YYYY-MM-DD`, where the caller is. */
async function todayFor(db: Db, userId: string): Promise<string> {
  const [row] = await db
    .select({ day: sql<string>`to_char((now() at time zone ${ownerZone})::date, 'YYYY-MM-DD')` })
    .from(user)
    .where(eq(user.id, userId));
  if (!row) throw badInput('Unknown account');
  return row.day;
}

/** `day` moved by `days`, both `YYYY-MM-DD`. Calendar arithmetic, so no zone. */
export function addDays(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function requireDay(value: string, name: string): string {
  if (!isCalendarDay(value)) throw badInput(`${name} must be a date, YYYY-MM-DD`);
  return value;
}

/** [from, to) defaulting to the `days` days up to and including today. */
async function window(
  db: Db,
  userId: string,
  args: { from?: string | null; to?: string | null },
  days: number,
): Promise<{ from: string; to: string }> {
  const to = args.to ? requireDay(args.to, 'to') : addDays(await todayFor(db, userId), 1);
  const from = args.from ? requireDay(args.from, 'from') : addDays(to, -days);
  if (from >= to) throw badInput('`from` must be before `to`');
  return { from, to };
}

/** A whole number in [1, max], or `fallback` when omitted. */
function clampLimit(value: number | null | undefined, fallback: number, max: number): number {
  if (value === null || value === undefined) return fallback;
  if (!Number.isInteger(value) || value < 1) throw badInput('limit must be a positive integer');
  return Math.min(value, max);
}

/** `%text%` for ILIKE, with the caller's own `%`, `_` and `\` taken literally. */
function containing(text: string): string {
  return `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/** The live-day bounds for whichever ends of a window were given. */
function optionalBounds(from: string | null | undefined, to: string | null | undefined): SQL[] {
  const bounds: SQL[] = [];
  if (from) {
    const parsed = parseRange({ from: requireDay(from, 'from'), to: from });
    bounds.push(liveDayBounds(parsed.from, parsed.to)[0]!);
  }
  if (to) {
    const parsed = parseRange({ from: to, to: requireDay(to, 'to') });
    bounds.push(liveDayBounds(parsed.from, parsed.to)[1]!);
  }
  return bounds;
}

const PREVIEW_ENTRIES = 50;

export function agentQueryFields(db: Db) {
  const summaries = summaryFields(db);
  // The dashboard's resolvers, called directly: same SQL, same seconds.
  const aggregate = <K extends 'categorySummary' | 'appSummary' | 'deviceSummary'>(
    name: K,
    args: Parameters<(typeof summaries)[K]>[1],
    ctx: Context,
  ) =>
    (summaries[name] as (source: unknown, args: unknown, ctx: Context) => Promise<unknown>)(
      {},
      args,
      ctx,
    ) as ReturnType<(typeof summaries)[K]>;

  return {
    daySummary: async (_source, args, ctx) => {
      const userId = requireUser(ctx);
      const day = args.day ? requireDay(args.day, 'day') : await todayFor(db, userId);
      const range = { from: day, to: addDays(day, 1) };
      const top = clampLimit(args.top, 10, 50);
      const [byCategory, byEntry, byDevice] = await Promise.all([
        aggregate('categorySummary', range, ctx),
        aggregate('appSummary', range, ctx),
        aggregate('deviceSummary', range, ctx),
      ]);
      const categoriesSorted = [...byCategory].sort((a, b) => b.seconds - a.seconds);
      const total = categoriesSorted.reduce((sum, row) => sum + row.seconds, 0);
      const uncategorized = categoriesSorted
        .filter((row) => row.categoryId === null)
        .reduce((sum, row) => sum + row.seconds, 0);
      return {
        day,
        totalSeconds: total,
        uncategorizedSeconds: uncategorized,
        categories: categoriesSorted,
        top: byEntry.slice(0, top),
        devices: byDevice,
      };
    },

    uncategorized: async (_source, args, ctx) => {
      const userId = requireUser(ctx);
      const range = await window(db, userId, args, 7);
      const limit = clampLimit(args.limit, 20, 100);
      const rows = await aggregate('appSummary', range, ctx);
      return rows.filter((row) => row.categoryId === null).slice(0, limit);
    },

    searchActivity: async (_source, args, ctx) => {
      const userId = requireUser(ctx);
      const query = args.query.trim();
      if (!query) throw badInput('Give something to search for');
      const limit = clampLimit(args.limit, 50, 200);
      const pattern = containing(query);
      const rows = await db
        .select({
          id: activities.id,
          app: activities.app,
          context: activities.context,
          title: activities.title,
          startedAt: activities.startedAt,
          lastActiveAt: activities.lastActiveAt,
          activeSeconds: activities.activeSeconds,
          deviceId: devices.id,
          deviceName: devices.name,
          categoryId: activities.categoryId,
          categoryName: categories.name,
        })
        .from(activities)
        .innerJoin(devices, ownerJoin.device)
        .innerJoin(user, ownerJoin.user)
        .leftJoin(categories, eq(activities.categoryId, categories.id))
        .where(
          and(
            eq(devices.userId, userId),
            or(
              ilike(activities.app, pattern),
              ilike(activities.context, pattern),
              ilike(activities.title, pattern),
            ),
            ...optionalBounds(args.from, args.to),
          ),
        )
        .orderBy(desc(activities.lastActiveAt))
        .limit(limit);
      return rows.map((row) => ({
        ...row,
        startedAt: row.startedAt.toISOString(),
        lastActiveAt: row.lastActiveAt.toISOString(),
      }));
    },

    previewCategoryRule: async (_source, args, ctx) => {
      const userId = requireUser(ctx);
      const patterns = {
        appPattern: args.appPattern || null,
        titlePattern: args.titlePattern || null,
        contextPattern: args.contextPattern || null,
      };
      if (!patterns.appPattern && !patterns.titlePattern && !patterns.contextPattern) {
        throw badInput('Give at least one pattern');
      }
      for (const pattern of Object.values(patterns)) if (pattern) assertValidPattern(pattern);
      const range = await window(db, userId, args, 30);
      const { from, to } = parseRange(range);

      const rows = await db
        .select({
          app: activities.app,
          context: activities.context,
          title: activities.title,
          seconds: activities.activeSeconds,
          source: activities.categorySource,
          categoryName: categories.name,
        })
        .from(activities)
        .innerJoin(devices, ownerJoin.device)
        .innerJoin(user, ownerJoin.user)
        .leftJoin(categories, eq(activities.categoryId, categories.id))
        .where(and(eq(devices.userId, userId), ...liveDayBounds(from, to)));

      // The rule's own matcher, on a rule that doesn't exist yet: what it
      // would match is exactly what a created one will.
      const rule = [patterns as CategoryRule];
      const entries = new Map<
        string,
        {
          app: string;
          context: string | null;
          seconds: number;
          activities: number;
          manual: number;
          categoryName: string | null;
        }
      >();
      let matched = 0;
      let changeable = 0;
      for (const row of rows) {
        if (!matchRule(rule, row.app, row.title, row.context)) continue;
        matched += row.seconds;
        const manual = row.source === 'manual';
        if (!manual) changeable += row.seconds;
        const key = `${row.app}\n${row.context ?? ''}\n${row.categoryName ?? ''}`;
        const entry = entries.get(key) ?? {
          app: row.app,
          context: row.context,
          seconds: 0,
          activities: 0,
          manual: 0,
          categoryName: row.categoryName,
        };
        entry.seconds += row.seconds;
        entry.activities += 1;
        if (manual) entry.manual += 1;
        entries.set(key, entry);
      }
      return {
        matchedSeconds: matched,
        changeableSeconds: changeable,
        entries: [...entries.values()]
          .sort((a, b) => b.seconds - a.seconds)
          .slice(0, PREVIEW_ENTRIES),
      };
    },
  } satisfies Pick<
    QueryResolvers,
    'daySummary' | 'uncategorized' | 'searchActivity' | 'previewCategoryRule'
  >;
}
