import { ask, askJson } from '@cubicecho/agent-core';
import { endpointFor, type LlmConfig } from './settings.ts';

// What the language model is asked (issue #41), and what is done with its
// answers before anyone sees them.
//
// Only names and totals go out by default — app, context (the site or project)
// and seconds. Window titles are sent only when the caller opts in for that
// request, since they are where the private detail lives.
//
// The model never writes a pattern. It picks an entry by number, says whether
// the rule should catch the whole app or just that context, and names a
// category; the server builds the anchored, escaped pattern itself. So a
// suggestion can't be a regex that matches everything, and the preview the
// dashboard shows is exactly what the saved rule will do.

export interface UncategorizedEntry {
  app: string;
  context: string | null;
  seconds: number;
  /** A few window titles seen under it — present only when the caller opted in. */
  titles?: string[];
}

export interface KnownCategory {
  id: string;
  name: string;
  kind: string;
}

export interface RuleSuggestion {
  app: string;
  context: string | null;
  seconds: number;
  appPattern: string;
  contextPattern: string | null;
  /** The existing category it files under, or null when it proposes a new one. */
  categoryId: string | null;
  categoryName: string;
  isNewCategory: boolean;
  reason: string;
}

interface ModelSuggestion {
  entry: number;
  scope: 'app' | 'context';
  category: string;
  reason: string;
}

const SUGGESTION_SCHEMA = {
  type: 'object',
  properties: {
    suggestions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          entry: { type: 'integer', description: 'The number of the entry, as listed.' },
          scope: {
            type: 'string',
            enum: ['app', 'context'],
            description:
              '"app" files every use of the app; "context" only this site or project within it.',
          },
          category: {
            type: 'string',
            description: 'An existing category name, exactly as listed, or a short new one.',
          },
          reason: { type: 'string', description: 'One short sentence on why.' },
        },
        required: ['entry', 'scope', 'category', 'reason'],
        additionalProperties: false,
      },
    },
  },
  required: ['suggestions'],
  additionalProperties: false,
};

const SUGGEST_SYSTEM = `You help someone sort the time an activity tracker recorded into categories.
You are given the entries no rule matched yet (an app, sometimes a context such as a website or project, and how long it was used) and the categories they already have.
For each entry you are confident about, suggest a category. Prefer their existing categories; propose a new one only when none fits, with a short plain name.
Choose "context" when the context decides the category (one website in a browser), and "app" when the app alone does (an editor, a chat app).
Skip entries you cannot place with confidence. Never suggest the same entry twice.`;

const STANDUP_SYSTEM = `You write a short, plain daily summary of someone's tracked computer time, in their own voice, for a standup.
Use only what the data shows; do not invent tasks or outcomes. Lead with where most of the time went.
Write 3 to 6 short bullet points in Markdown, then nothing else. Round times to the nearest 5 minutes.`;

/**
 * `^text$` with every regex metacharacter escaped: matches the value exactly.
 * The same escaping as the dashboard's rule editor (web lib/pattern.ts), so it
 * opens a suggested rule in its "is exactly" mode rather than as a raw regex.
 */
export function exactPattern(value: string): string {
  return `^${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`;
}

/** Seconds as "1h 25m" / "40m". */
export function duration(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/** Titles are quoted and clipped: they are data, and a long one is mostly noise. */
const quoted = (title: string) =>
  JSON.stringify(title.length > 120 ? `${title.slice(0, 117)}…` : title);

function describeEntries(entries: UncategorizedEntry[]): string {
  return entries
    .map((entry, index) => {
      const name = entry.context ? `${entry.app} — ${entry.context}` : entry.app;
      const titles = entry.titles?.length
        ? `\n   window titles: ${entry.titles.map(quoted).join(', ')}`
        : '';
      return `${index + 1}. ${name} (${duration(entry.seconds)})${titles}`;
    })
    .join('\n');
}

/**
 * Asks for categories for the uncategorized entries and turns the answer into
 * rules the server can stand behind. Invalid or duplicate picks are dropped.
 */
export async function suggestRules(
  config: LlmConfig,
  entries: UncategorizedEntry[],
  categories: KnownCategory[],
  options: { signal?: AbortSignal } = {},
): Promise<RuleSuggestion[]> {
  if (entries.length === 0) return [];
  const known =
    categories.length === 0
      ? '(none yet)'
      : categories.map((category) => `- ${category.name} (${category.kind})`).join('\n');
  const user = `Categories they have:\n${known}\n\nUncategorized entries, largest first:\n${describeEntries(entries)}`;

  const answer = await askJson<{ suggestions?: ModelSuggestion[] }>(
    endpointFor(config),
    config.model,
    SUGGEST_SYSTEM,
    user,
    SUGGESTION_SCHEMA,
    { name: 'rule_suggestions', maxTokens: 1500, temperature: 0.2, signal: options.signal },
  );

  const byName = new Map(categories.map((category) => [category.name.toLowerCase(), category]));
  const seen = new Set<string>();
  const out: RuleSuggestion[] = [];
  for (const pick of answer?.suggestions ?? []) {
    const entry = Number.isInteger(pick.entry) ? entries[pick.entry - 1] : undefined;
    const name = typeof pick.category === 'string' ? pick.category.trim().slice(0, 60) : '';
    if (!entry || !name) continue;
    // "context" only means something for an entry that has one.
    const byContext = pick.scope === 'context' && entry.context !== null;
    const appPattern = exactPattern(entry.app);
    const contextPattern = byContext ? exactPattern(entry.context!) : null;
    const key = `${appPattern}\n${contextPattern ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const existing = byName.get(name.toLowerCase());
    out.push({
      app: entry.app,
      context: byContext ? entry.context : null,
      seconds: entry.seconds,
      appPattern,
      contextPattern,
      categoryId: existing?.id ?? null,
      categoryName: existing?.name ?? name,
      isNewCategory: !existing,
      reason: typeof pick.reason === 'string' ? pick.reason.trim().slice(0, 300) : '',
    });
  }
  return out;
}

export interface DayFacts {
  day: string;
  totalSeconds: number;
  categories: { name: string; kind: string | null; seconds: number }[];
  top: UncategorizedEntry[];
}

/** A short standup-style summary of one day, drafted for the person to edit. */
export async function draftStandup(
  config: LlmConfig,
  facts: DayFacts,
  options: { signal?: AbortSignal } = {},
): Promise<string> {
  const categories = facts.categories
    .map((row) => `- ${row.name}${row.kind ? ` (${row.kind})` : ''}: ${duration(row.seconds)}`)
    .join('\n');
  const user = `Day: ${facts.day}\nTotal tracked: ${duration(facts.totalSeconds)}\n\nBy category:\n${categories || '(nothing)'}\n\nMost used:\n${describeEntries(facts.top) || '(nothing)'}`;
  return ask(endpointFor(config), config.model, STANDUP_SYSTEM, user, {
    maxTokens: 600,
    temperature: 0.3,
    signal: options.signal,
  });
}
