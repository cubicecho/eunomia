import {
  type ActivitySample,
  fetchCategories,
  fetchCategoryRules,
  fetchContextRules,
  fetchRecentActivities,
  fetchRulePacks,
  fetchSummary,
} from '@/api';
import { LoadError, RowSkeleton } from '@/components/load-state';
import { CategoriesCard, type CategoryUsage } from '@/components/rules/categories-card';
import { CategoryRulesCard } from '@/components/rules/category-rules-card';
import { ContextRulesCard } from '@/components/rules/context-rules-card';
import { RulePacksCard } from '@/components/rules/rule-packs-card';
import { StatusLine } from '@/components/status-line';
import { useAction, useQuery } from '@/hooks/use-query';
import { rangeOfEverything } from '@/lib/format';
import { useTimeZone } from '@/session';

// Loads everything the cards below need in one round trip and owns the
// reload they share: editing a category changes what the rule forms can pick,
// and applying rules changes what the tables say, so they reload together.

export function RulesView() {
  const timeZone = useTimeZone();
  const { data, error, reload, refetch } = useQuery(
    () =>
      Promise.all([
        fetchCategories(),
        fetchCategoryRules(),
        fetchContextRules(),
        fetchRulePacks(),
        // The corpus the rule forms preview against. A failure here costs the
        // preview, not the whole view — rules are still editable without it.
        fetchRecentActivities().catch((): ActivitySample[] => []),
        // All-time totals per category, for what a merge or delete would
        // move. Null on failure: the card then shows rule counts alone.
        (() => {
          const range = rangeOfEverything(timeZone);
          return fetchSummary(range.from, range.to).catch(() => null);
        })(),
      ]),
    [timeZone],
  );
  const action = useAction();

  if (error && !data) return <LoadError error={error} onRetry={refetch} what="your rules" />;
  if (!data) return <RowSkeleton rows={3} />;
  const [categories, categoryRules, contextRules, packs, samples, totals] = data;
  const usage = new Map<string, CategoryUsage>(
    categories.map((category) => [category.id, { rules: 0, seconds: totals ? 0 : null }]),
  );
  for (const rule of categoryRules) {
    const entry = usage.get(rule.categoryId);
    if (entry) entry.rules += 1;
  }
  for (const row of totals ?? []) {
    const entry = row.categoryId ? usage.get(row.categoryId) : undefined;
    if (entry && entry.seconds !== null) entry.seconds += row.seconds;
  }
  const run = (mutation: () => Promise<unknown>) => action.run(mutation, { onDone: reload });

  return (
    <div className="flex flex-col gap-6">
      <RulePacksCard packs={packs} reload={reload} />
      <CategoriesCard categories={categories} usage={usage} run={run} reload={reload} />
      <CategoryRulesCard
        categories={categories}
        rules={categoryRules}
        samples={samples}
        run={run}
        reload={reload}
      />
      <ContextRulesCard rules={contextRules} samples={samples} run={run} reload={reload} />
      <StatusLine status={action.status} />
    </div>
  );
}
