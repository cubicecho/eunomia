import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { type GraphQLSchema, graphql } from 'graphql';
import { z } from 'zod';
import { addDays } from './graphql/agent-fields.ts';
import type { Context } from './graphql/context.ts';
import { isCalendarDay } from './graphql/summaries.ts';

// MCP prompts: the three things people most often ask an assistant to do with
// their time, as templates a client can offer by name (issue #40). Each one
// fetches the caller's own data first — through the same schema and
// permissions as the tools, as the same caller — and hands it over with the
// instructions, so the assistant starts from the numbers instead of from a
// round of tool calls it might get wrong.

/** Runs one read as the caller; a refusal (anonymous, say) becomes the prompt's error. */
async function read<T>(
  schema: GraphQLSchema,
  ctx: Context,
  source: string,
  variables: Record<string, unknown> = {},
): Promise<T> {
  const result = await graphql({ schema, source, variableValues: variables, contextValue: ctx });
  if (result.errors?.length) throw new Error(result.errors.map((e) => e.message).join('; '));
  return result.data as T;
}

const DAY = `
  day totalSeconds uncategorizedSeconds
  categories { name kind seconds }
  top { app context categoryName seconds }
  devices { name platform seconds }
`;

/** Data blocks the model reads; seconds stay seconds, so nothing is rounded twice. */
const block = (label: string, data: unknown): string =>
  `${label}:\n\`\`\`json\n${JSON.stringify(data, null, 2)}\n\`\`\``;

/**
 * A prompt's argument shape as the SDK's types spell it. The SDK is typed
 * against the zod 3.25 at the repo root, this package uses zod 4; both speak
 * zod 4's core protocol at runtime, which is what the SDK parses through, so
 * only the static types disagree (mcp.test.ts covers the runtime).
 */
type PromptArgs = Record<string, never>;
const args = (shape: Record<string, z.ZodType>): PromptArgs => shape as unknown as PromptArgs;

const message = (text: string) => ({
  messages: [{ role: 'user' as const, content: { type: 'text' as const, text } }],
});

const dayArg = z
  .string()
  .optional()
  .describe('YYYY-MM-DD in your time zone. Omitted: today.')
  .refine((value) => value === undefined || isCalendarDay(value), 'Use YYYY-MM-DD');

async function today(schema: GraphQLSchema, ctx: Context): Promise<string> {
  const data = await read<{ daySummary: { day: string } }>(
    schema,
    ctx,
    '{ daySummary(top: 1) { day } }',
  );
  return data.daySummary.day;
}

/**
 * Registers the prompts on one server. `canCategorize` says whether this
 * caller was given the write tools, so triage can say what to do next instead
 * of suggesting a tool that isn't there.
 */
export function registerPrompts(
  server: McpServer,
  schema: GraphQLSchema,
  ctx: Context,
  canCategorize: boolean,
): void {
  server.registerPrompt(
    'standup',
    {
      title: 'Standup',
      description: 'A short standup from yesterday and today: what the time went on.',
      argsSchema: args({ day: dayArg }),
    },
    async ({ day }: { day?: string }) => {
      const on = day ?? (await today(schema, ctx));
      const yesterday = addDays(on, -1);
      const data = await read<{ yesterday: unknown; today: unknown }>(
        schema,
        ctx,
        `query ($yesterday: String!, $today: String!) {
          yesterday: daySummary(day: $yesterday) { ${DAY} }
          today: daySummary(day: $today) { ${DAY} }
        }`,
        { yesterday, today: on },
      );
      return message(
        [
          `Write my standup for ${on} from the tracked time below: a few bullets on what I worked on ` +
            `yesterday (${yesterday}) and what I'm on today, in plain words. Name projects, sites and ` +
            'documents from the `context` fields where they say more than the app does. Durations are ' +
            'in seconds; give them as hours and minutes, rounded. Leave out anything under ten minutes ' +
            'unless it stands out, and say nothing about time you have no data for.',
          block('Yesterday', data.yesterday),
          block('Today so far', data.today),
        ].join('\n\n'),
      );
    },
  );

  server.registerPrompt(
    'weekly_review',
    {
      title: 'Weekly review',
      description: 'The last 7 days against the 7 before: where time went and what changed.',
      argsSchema: args({
        week_ending: dayArg.describe('Last day of the week, YYYY-MM-DD. Omitted: today.'),
      }),
    },
    async ({ week_ending }: { week_ending?: string }) => {
      const last = week_ending ?? (await today(schema, ctx));
      const to = addDays(last, 1);
      const from = addDays(to, -7);
      const before = addDays(from, -7);
      const data = await read<Record<string, unknown>>(
        schema,
        ctx,
        `query ($before: String!, $from: String!, $to: String!) {
          thisWeek: categorySummary(from: $from, to: $to) { day name kind seconds }
          lastWeek: categorySummary(from: $before, to: $from) { day name kind seconds }
          topThisWeek: appSummary(from: $from, to: $to) { app context categoryName seconds }
          devices: deviceSummary(from: $from, to: $to) { name platform seconds }
        }`,
        { before, from, to },
      );
      const top = (data.topThisWeek as unknown[]).slice(0, 25);
      return message(
        [
          `Review my week ${from} to ${last} from the tracked time below, against the week before. ` +
            'Cover: total time and how it split by category kind (focus, work, neutral, personal, ' +
            'distracting); the categories and entries that grew or shrank the most; which days were ' +
            'heaviest; and one or two things worth changing. Durations are in seconds; give hours and ' +
            'minutes. Be concrete and brief, and point out uncategorized time (null name) if there is ' +
            'a lot of it rather than guessing what it was.',
          block('This week, per category per day', data.thisWeek),
          block('Last week, per category per day', data.lastWeek),
          block('This week, biggest entries', top),
          block('This week, per device', data.devices),
        ].join('\n\n'),
      );
    },
  );

  server.registerPrompt(
    'categorize_triage',
    {
      title: 'Categorization triage',
      description:
        'The biggest uncategorized time, with your categories and rules, and rules to cover it.',
      argsSchema: args({
        days: z
          .string()
          .optional()
          .describe('How many days back to look. Default 7.')
          .refine(
            (value) => value === undefined || /^[1-9]\d{0,2}$/.test(value),
            'A number of days',
          ),
      }),
    },
    async ({ days }: { days?: string }) => {
      const span = days ? Number(days) : 7;
      const to = addDays(await today(schema, ctx), 1);
      const from = addDays(to, -span);
      const data = await read<Record<string, unknown>>(
        schema,
        ctx,
        `query ($from: String!, $to: String!) {
          uncategorized(from: $from, to: $to, limit: 30) { app context seconds }
          categories { id name kind }
          categoryRules { categoryId appPattern titlePattern contextPattern priority }
        }`,
        { from, to },
      );
      const next = canCategorize
        ? 'Check each proposed rule with `preview_category_rule` and show me what it would match. ' +
          'Create nothing until I say which ones to keep; then use `create_category_rule` (and ' +
          '`create_category` for a category I agree to add), and finish with ' +
          '`apply_category_rules` so past time moves too. For a one-off entry that needs no rule, ' +
          '`assign_entry` over the same window.'
        : 'Check each proposed rule with `preview_category_rule` and show me what it would match. ' +
          "This connection can't write, so list the rules for me to add in eunomia's Rules tab " +
          '(or I can make an API key with the Categorize permission and reconnect).';
      return message(
        [
          `Help me categorize the biggest uncategorized time from ${from} to ${addDays(to, -1)}. ` +
            'Group the entries below into a few rules for my existing categories; propose a new ' +
            "category only when nothing fits. A rule's patterns are case-insensitive regular " +
            'expressions on the app, the window title or the context (a site or project), and all ' +
            'the patterns it has must match. Prefer app and context patterns over title ones, ' +
            'and anchor them (`^code$`) so they catch only what they should. Seconds are seconds.',
          next,
          block('Uncategorized, largest first', data.uncategorized),
          block('My categories', data.categories),
          block('My rules', data.categoryRules),
        ].join('\n\n'),
      );
    },
  );
}
