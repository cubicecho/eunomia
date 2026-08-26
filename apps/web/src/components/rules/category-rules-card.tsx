import { type ActivitySample, type Category, type CategoryRule, deleteCategoryRule } from '@/api';
import { ConfirmDelete } from '@/components/confirm-delete';
import { EmptyState } from '@/components/empty-state';
import { ApplyRules } from '@/components/rules/apply-rules';
import { CategoryRuleForm } from '@/components/rules/category-rule-form';
import { Pattern } from '@/components/rules/pattern';
import { AddRuleButton, EditRuleButton, RuleDialog } from '@/components/rules/rule-dialog';
import { Swatch } from '@/components/rules/swatch';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { Run } from '@/hooks/use-query';
import { categoryColor } from '@/lib/palette';

interface Props {
  categories: Category[];
  rules: CategoryRule[];
  /** The corpus the rule form previews against; may be empty. */
  samples: ActivitySample[];
  run: Run;
  reload: () => void;
}

export function CategoryRulesCard({ categories, rules, samples, run, reload }: Props) {
  const byId = new Map(categories.map((category) => [category.id, category]));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Category rules</CardTitle>
        <CardDescription>
          The first matching rule (lowest priority first) sets an activity’s category. Manual
          assignments always win.
        </CardDescription>
        <CardAction>
          <RuleDialog
            title="New category rule"
            description="Match on the app, the window title, the context, or any combination of them."
            trigger={<AddRuleButton label="Add rule" disabled={categories.length === 0} />}
          >
            {(close) => (
              <CategoryRuleForm
                categories={categories}
                samples={samples}
                onSaved={() => {
                  close();
                  reload();
                }}
              />
            )}
          </RuleDialog>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {categories.length === 0 && (
          <EmptyState>Create a category first, then add rules for it.</EmptyState>
        )}
        {categories.length > 0 && rules.length === 0 && (
          <EmptyState>No rules yet — new activities stay uncategorized.</EmptyState>
        )}
        {rules.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Category</TableHead>
                <TableHead>App</TableHead>
                <TableHead>Title</TableHead>
                <TableHead>Context</TableHead>
                <TableHead className="w-20">Priority</TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {[...rules]
                .sort((a, b) => a.priority - b.priority)
                .map((rule) => {
                  const category = byId.get(rule.categoryId);
                  const name = category?.name ?? '?';
                  return (
                    <TableRow key={rule.id}>
                      <TableCell>
                        <span className="flex items-center gap-2">
                          <Swatch color={categoryColor(rule.categoryId, category?.color ?? null)} />
                          {name}
                        </span>
                      </TableCell>
                      <TableCell>
                        <Pattern value={rule.appPattern} />
                      </TableCell>
                      <TableCell>
                        <Pattern value={rule.titlePattern} />
                      </TableCell>
                      <TableCell>
                        <Pattern value={rule.contextPattern} />
                      </TableCell>
                      <TableCell className="text-muted-foreground tabular-nums">
                        {rule.priority}
                      </TableCell>
                      <TableCell>
                        <span className="flex items-center justify-end">
                          <RuleDialog
                            title="Edit category rule"
                            description="Saving replaces the rule. Activities it already categorized keep their category until you apply the rules again."
                            trigger={<EditRuleButton label={`${name} rule`} />}
                          >
                            {(close) => (
                              <CategoryRuleForm
                                categories={categories}
                                samples={samples}
                                rule={rule}
                                onSaved={() => {
                                  close();
                                  reload();
                                }}
                              />
                            )}
                          </RuleDialog>
                          <ConfirmDelete
                            name={`${name} rule`}
                            description="Activities already categorized by this rule keep their category until you apply the rules again."
                            onConfirm={() => run(() => deleteCategoryRule(rule.id))}
                          />
                        </span>
                      </TableCell>
                    </TableRow>
                  );
                })}
            </TableBody>
          </Table>
        )}
        {rules.length > 0 && <ApplyRules />}
      </CardContent>
    </Card>
  );
}
