import {
  type ActivitySample,
  fetchCategories,
  fetchCategoryRules,
  fetchContextRules,
  fetchRecentActivities,
  fetchRulePacks,
} from '@/api';
import { QueryError, RowSkeleton } from '@/components/query-state';
import { CategoriesCard } from '@/components/rules/categories-card';
import { CategoryRulesCard } from '@/components/rules/category-rules-card';
import { ContextRulesCard } from '@/components/rules/context-rules-card';
import { RulePacksCard } from '@/components/rules/rule-packs-card';
import { StatusLine } from '@/components/status-line';
import { useAction, useQuery } from '@/hooks/use-query';

// Loads everything the cards below need in one round trip and owns the
// reload they share: editing a category changes what the rule forms can pick,
// and applying rules changes what the tables say, so they reload together.

export function RulesView() {
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
      ]),
    [],
  );
  const action = useAction();

  if (error && !data) return <QueryError error={error} onRetry={refetch} what="your rules" />;
  if (!data) return <RowSkeleton rows={3} />;
  const [categories, categoryRules, contextRules, packs, samples] = data;
  const run = (mutation: () => Promise<unknown>) => action.run(mutation, { onDone: reload });

  return (
    <div className="flex flex-col gap-6">
      <RulePacksCard packs={packs} reload={reload} />
      <CategoriesCard categories={categories} run={run} reload={reload} />
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
