import type { MutationResolvers, QueryResolvers } from '@eunomia/gql/resolvers';
import { and, desc, eq, isNotNull, isNull } from 'drizzle-orm';
import { ownerJoin } from '../activity/rollup.ts';
import type { Db } from '../db/client.ts';
import { activities, categories, devices, user } from '../db/schema.ts';
import { badInput, failedPrecondition, forbidden, unavailable } from '../errors.ts';
import { draftStandup, suggestRules, type UncategorizedEntry } from '../llm/assist.ts';
import {
  clearLlm,
  effectiveLlm,
  type LlmConfig,
  normalizeBaseUrl,
  saveLlm,
} from '../llm/settings.ts';
import { isAdmin } from '../oidc/settings.ts';
import { addDays, agentQueryFields, window } from './agent-fields.ts';
import type { Context } from './context.ts';
import { requireUser } from './guards.ts';
import { liveDayBounds, parseRange } from './summaries.ts';

// Bring-your-own language model (issue #41): rule suggestions for
// uncategorized time and a drafted standup, from whatever OpenAI-compatible
// endpoint the instance is pointed at. Both are reads — nothing here creates a
// rule or changes a category. The dashboard shows the suggestions, and a
// person saving one goes through createCategoryRule like any other rule.
//
// The data comes from the agent reads (#40), so the numbers the model sees
// are the dashboard's numbers.

const TITLES_PER_ENTRY = 3;

async function settingsFor(db: Db, ctx: Context) {
  const { config, source } = await effectiveLlm(db);
  const admin = Boolean(ctx.userId && !ctx.keyId && (await isAdmin(db, ctx.userId)));
  return {
    source,
    baseUrl: config?.baseUrl ?? null,
    model: config?.model ?? null,
    hasApiKey: Boolean(config?.apiKey),
    canEdit: admin && source !== 'ENV',
  };
}

async function requireModel(db: Db): Promise<LlmConfig> {
  const { config } = await effectiveLlm(db);
  if (!config) {
    throw failedPrecondition(
      'No language model is set up. The admin can point eunomia at one under Settings.',
    );
  }
  return config;
}

/** The model's failure, as something the dashboard can say. The key never appears in it. */
function modelFailed(config: LlmConfig, error: unknown): Error {
  const host = (() => {
    try {
      return new URL(config.baseUrl).host;
    } catch {
      return config.baseUrl;
    }
  })();
  const detail = error instanceof Error ? error.message : String(error);
  return unavailable(`The language model at ${host} (${config.model}) didn't answer: ${detail}`);
}

/** A few distinct window titles seen under an entry in the window, most recent first. */
async function titlesFor(
  db: Db,
  userId: string,
  range: { from: string; to: string },
  entry: { app: string; context: string | null },
): Promise<string[]> {
  const { from, to } = parseRange(range);
  const rows = await db
    .selectDistinctOn([activities.title], { title: activities.title, at: activities.lastActiveAt })
    .from(activities)
    .innerJoin(devices, ownerJoin.device)
    .innerJoin(user, ownerJoin.user)
    .where(
      and(
        eq(devices.userId, userId),
        eq(activities.app, entry.app),
        entry.context === null ? isNull(activities.context) : eq(activities.context, entry.context),
        isNotNull(activities.title),
        ...liveDayBounds(from, to),
      ),
    )
    .orderBy(activities.title, desc(activities.lastActiveAt))
    .limit(20);
  return rows
    .sort((a, b) => b.at.getTime() - a.at.getTime())
    .map((row) => row.title!)
    .slice(0, TITLES_PER_ENTRY);
}

export function llmQueryFields(db: Db) {
  // The agent resolvers, called directly with the caller's context.
  const agent = agentQueryFields(db);

  return {
    llmSettings: (_source, _args, ctx) => settingsFor(db, ctx),

    suggestRules: async (_source, args, ctx) => {
      const userId = requireUser(ctx);
      const config = await requireModel(db);
      const limit = Math.min(Math.max(args.limit ?? 15, 1), 40);
      // One window for the totals, the titles and the previews, so they agree.
      const range = await window(db, userId, args, 7);
      const rows = await agent.uncategorized({}, { ...range, limit }, ctx);
      let entries: UncategorizedEntry[] = rows.map(({ app, context, seconds }) => ({
        app,
        context,
        seconds,
      }));
      if (args.includeTitles && entries.length > 0) {
        entries = await Promise.all(
          entries.map(async (entry) => ({
            ...entry,
            titles: await titlesFor(db, userId, range, entry),
          })),
        );
      }
      const known = await db
        .select({ id: categories.id, name: categories.name, kind: categories.kind })
        .from(categories)
        .where(eq(categories.userId, userId));

      let suggestions: Awaited<ReturnType<typeof suggestRules>>;
      try {
        suggestions = await suggestRules(config, entries, known);
      } catch (error) {
        throw modelFailed(config, error);
      }
      return Promise.all(
        suggestions.map(async (suggestion) => ({
          ...suggestion,
          preview: await agent.previewCategoryRule(
            {},
            {
              appPattern: suggestion.appPattern,
              contextPattern: suggestion.contextPattern,
              ...range,
            },
            ctx,
          ),
        })),
      );
    },

    draftStandup: async (_source, args, ctx) => {
      const userId = requireUser(ctx);
      const config = await requireModel(db);
      const summary = await agent.daySummary({}, { day: args.day, top: 10 }, ctx);
      const range = { from: summary.day, to: addDays(summary.day, 1) };
      const top: UncategorizedEntry[] = await Promise.all(
        summary.top.map(async ({ app, context, seconds }) => ({
          app,
          context,
          seconds,
          ...(args.includeTitles
            ? { titles: await titlesFor(db, userId, range, { app, context }) }
            : {}),
        })),
      );
      let text: string;
      try {
        text = await draftStandup(config, {
          day: summary.day,
          totalSeconds: summary.totalSeconds,
          categories: summary.categories.map((row) => ({
            name: row.name ?? 'Uncategorized',
            kind: row.kind,
            seconds: row.seconds,
          })),
          top,
        });
      } catch (error) {
        throw modelFailed(config, error);
      }
      if (!text.trim()) throw modelFailed(config, new Error('it sent back an empty answer'));
      return { day: summary.day, text };
    },
  } satisfies Pick<QueryResolvers, 'llmSettings' | 'suggestRules' | 'draftStandup'>;
}

/** Refuses anyone but the admin, and a setting the environment owns. */
async function requireEditor(db: Db, ctx: Context): Promise<void> {
  const { source } = await effectiveLlm(db);
  if (source === 'ENV') {
    throw forbidden("The language model is set by LLM_BASE_URL in the server's environment.");
  }
  if (!ctx.userId || ctx.keyId || !(await isAdmin(db, ctx.userId))) {
    throw forbidden('Only the admin can change the language model.');
  }
}

export function llmFields(db: Db) {
  return {
    setLlmSettings: async (_source, args, ctx) => {
      await requireEditor(db, ctx);
      const baseUrl = normalizeBaseUrl(args.baseUrl);
      if (!baseUrl) {
        throw badInput(
          'The base URL must be an http(s) address with no credentials, query or fragment, like http://localhost:11434/v1.',
        );
      }
      const model = args.model.trim();
      if (!model) throw badInput('Name the model to use, like llama3.1:8b.');
      const apiKey =
        args.apiKey === undefined ? undefined : args.apiKey?.trim() ? args.apiKey.trim() : null;
      await saveLlm(db, { baseUrl, model, apiKey });
      return settingsFor(db, ctx);
    },
    clearLlmSettings: async (_source, _args, ctx) => {
      await requireEditor(db, ctx);
      await clearLlm(db);
      return settingsFor(db, ctx);
    },
  } satisfies Pick<MutationResolvers, 'setLlmSettings' | 'clearLlmSettings'>;
}
