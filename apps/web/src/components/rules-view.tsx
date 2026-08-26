import {
  type ActivitySample,
  fetchCategories,
  fetchCategoryRules,
  fetchContextRules,
  fetchRecentActivities,
} from '@/api';
import { CategoriesCard } from '@/components/rules/categories-card';
import { CategoryRulesCard } from '@/components/rules/category-rules-card';
import { ContextRulesCard } from '@/components/rules/context-rules-card';
import { StatusLine } from '@/components/status-line';
import { useAction, useQuery } from '@/hooks/use-query';

// Loads everything the three cards below need in one round trip and owns the
// reload they share: editing a category changes what the rule forms can pick,
// and applying rules changes what the tables say, so they reload together.

export function RulesView() {
  const { data, error, reload } = useQuery(
    () =>
      Promise.all([
        fetchCategories(),
        fetchCategoryRules(),
        fetchContextRules(),
        // The corpus the rule forms preview against. A failure here costs the
        // preview, not the whole view — rules are still editable without it.
        fetchRecentActivities().catch((): ActivitySample[] => []),
      ]),
    [],
  );
  const action = useAction();

  if (error) return <p className="text-destructive text-sm">{error}</p>;
  if (!data) return null;
  const [categories, categoryRules, contextRules, samples] = data;
  const run = (mutation: () => Promise<unknown>) => action.run(mutation, { onDone: reload });

  return (
    <div className="flex flex-col gap-6">
      <CategoriesCard categories={categories} run={run} />
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
