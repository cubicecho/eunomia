import { Trash2 } from 'lucide-react';
import { type ActivitySample, type Category, type CategoryRule, deleteCategoryRule } from '@/api';
import { CardLayout } from '@/components/card-layout';
import { ConfirmButton } from '@/components/confirm-button';
import { EmptyState } from '@/components/empty-state';
import { ApplyRules } from '@/components/rules/apply-rules';
import { CategoryRuleForm } from '@/components/rules/category-rule-form';
import { Pattern } from '@/components/rules/pattern';
import { addRuleTrigger, editRuleTrigger, RuleDialog } from '@/components/rules/rule-dialog';
import { Swatch } from '@/components/rules/swatch';
import { Badge } from '@/components/ui/badge';
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
    <CardLayout
      title="Category rules"
      description="The first matching rule (lowest priority first) sets an activity’s category. Manual assignments always win."
      actionSlot={
        <RuleDialog
          title="New category rule"
          description="Match on the app, the window title, the context, or any combination of them."
          trigger={addRuleTrigger('Add rule', categories.length === 0)}
        >
          {(host) => (
            <CategoryRuleForm
              host={host}
              categories={categories}
              samples={samples}
              onSaved={() => {
                host.close();
                reload();
              }}
            />
          )}
        </RuleDialog>
      }
      contentClassName="gap-4"
      contentSlot={
        rules.length === 0 ? null : (
          <>
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
                            <Swatch
                              color={categoryColor(rule.categoryId, category?.color ?? null)}
                            />
                            {name}
                            {rule.pack && (
                              // Still an ordinary rule; the badge only says where it came from.
                              <Badge
                                variant="outline"
                                title={`From the ${rule.pack.split('/')[0]} rule pack`}
                              >
                                pack
                              </Badge>
                            )}
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
                          <span className="flex items-center justify-end gap-1">
                            <RuleDialog
                              title="Edit category rule"
                              description="Saving replaces the rule. Activities it already categorized keep their category until you apply the rules again."
                              trigger={editRuleTrigger(`${name} rule`)}
                            >
                              {(host) => (
                                <CategoryRuleForm
                                  host={host}
                                  categories={categories}
                                  samples={samples}
                                  rule={rule}
                                  onSaved={() => {
                                    host.close();
                                    reload();
                                  }}
                                />
                              )}
                            </RuleDialog>
                            <ConfirmButton
                              variant="outline"
                              size="icon-sm"
                              aria-label={`Delete ${name} rule`}
                              hint={`Delete ${name} rule`}
                              iconSlot={<Trash2 />}
                              title={`Delete the ${name} rule?`}
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
            <ApplyRules />
          </>
        )
      }
      emptySlot={
        <EmptyState
          compact
          title={
            categories.length === 0
              ? 'Create a category first, then add rules for it.'
              : 'No rules yet — new activities stay uncategorized.'
          }
        />
      }
    />
  );
}
