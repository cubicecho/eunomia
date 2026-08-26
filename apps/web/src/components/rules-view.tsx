import { useState } from 'react';
import {
  type ActivitySample,
  type Category,
  createCategory,
  deleteCategory,
  deleteCategoryRule,
  deleteContextRule,
  fetchCategories,
  fetchCategoryRules,
  fetchContextRules,
  fetchRecentActivities,
} from '@/api';
import { ConfirmDelete } from '@/components/confirm-delete';
import { EmptyState } from '@/components/empty-state';
import { ApplyRules } from '@/components/rules/apply-rules';
import { CategoryRuleForm } from '@/components/rules/category-rule-form';
import { ContextRuleForm } from '@/components/rules/context-rule-form';
import { AddRuleButton, EditRuleButton, RuleDialog } from '@/components/rules/rule-dialog';
import { StatusLine } from '@/components/status-line';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useAction, useQuery } from '@/hooks/use-query';
import { categoryColor, CHART_COLORS } from '@/lib/palette';
import { describeExtractPattern, describePattern } from '@/lib/pattern';

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
  const byId = new Map(categories.map((category) => [category.id, category]));
  const run = (mutation: () => Promise<unknown>) => action.run(mutation, { onDone: reload });

  return (
    <div className="flex flex-col gap-6">
      <Categories categories={categories} run={run} />

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
          {categories.length > 0 && categoryRules.length === 0 && (
            <EmptyState>No rules yet — new activities stay uncategorized.</EmptyState>
          )}
          {categoryRules.length > 0 && (
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
                {[...categoryRules]
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
          {categoryRules.length > 0 && <ApplyRules />}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Context rules</CardTitle>
          <CardDescription>
            Splits an app’s time by what was open in it — the project in an editor, the site in a
            browser — by pulling the context out of the window title. Only applies to pings without
            a context of their own, and only going forward.
          </CardDescription>
          <CardAction>
            <RuleDialog
              title="New context rule"
              description="Pick the part of the window title that names what was open — the preview shows what it would pull out of recent titles."
              trigger={<AddRuleButton label="Add rule" />}
            >
              {(close) => (
                <ContextRuleForm
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
          {contextRules.length === 0 && (
            <EmptyState>No context rules yet — every app folds as one activity.</EmptyState>
          )}
          {contextRules.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>App</TableHead>
                  <TableHead>Context is</TableHead>
                  <TableHead className="w-20">Priority</TableHead>
                  <TableHead className="w-24" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {[...contextRules]
                  .sort((a, b) => a.priority - b.priority)
                  .map((rule) => (
                    <TableRow key={rule.id}>
                      <TableCell>
                        <Pattern value={rule.appPattern} />
                      </TableCell>
                      <TableCell>
                        <span
                          className="text-muted-foreground text-sm"
                          title={rule.titlePattern}
                        >
                          {describeExtractPattern(rule.titlePattern)}
                        </span>
                      </TableCell>
                      <TableCell className="text-muted-foreground tabular-nums">
                        {rule.priority}
                      </TableCell>
                      <TableCell>
                        <span className="flex items-center justify-end">
                          <RuleDialog
                            title="Edit context rule"
                            description="Saving replaces the rule. Activities already split by it keep the contexts they have; the new pattern applies from the next ping on."
                            trigger={<EditRuleButton label="context rule" />}
                          >
                            {(close) => (
                              <ContextRuleForm
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
                            name="context rule"
                            description="Activities already split by this rule keep their contexts; new pings fold by app alone."
                            onConfirm={() => run(() => deleteContextRule(rule.id))}
                          />
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <StatusLine status={action.status} />
    </div>
  );
}

type Run = (mutation: () => Promise<unknown>) => void;

function Swatch({ color }: { color: string }) {
  return (
    <span aria-hidden className="size-2.5 shrink-0 rounded-[2px]" style={{ background: color }} />
  );
}

/**
 * Rules are stored as regexes but read back in the words the form used to
 * write them; the raw pattern stays one hover away.
 */
function Pattern({ value }: { value: string | null }) {
  if (value === null) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="text-muted-foreground text-sm" title={value}>
      {describePattern(value)}
    </span>
  );
}

function Categories({ categories, run }: { categories: Category[]; run: Run }) {
  const [name, setName] = useState('');
  const [color, setColor] = useState<string>(CHART_COLORS[0]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Categories</CardTitle>
        <CardDescription>
          Deleting a category keeps its activities — they go back to uncategorized.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {categories.length === 0 ? (
          <EmptyState>No categories yet.</EmptyState>
        ) : (
          <ul className="flex flex-col">
            {[...categories]
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((category) => (
                <li
                  key={category.id}
                  className="flex items-center gap-2 border-b border-dashed py-1.5 last:border-0"
                >
                  <Swatch color={categoryColor(category.id, category.color)} />
                  <span className="grow text-sm">{category.name}</span>
                  <ConfirmDelete
                    name={category.name}
                    description="Its rules are deleted too. The activities it holds stay, as uncategorized time."
                    onConfirm={() => run(() => deleteCategory(category.id))}
                  />
                </li>
              ))}
          </ul>
        )}
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (!name.trim()) return;
            run(() => createCategory(name.trim(), color));
            setName('');
          }}
        >
          <Input
            className="w-48"
            placeholder="new category"
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
          />
          {/* The palette the charts actually draw from, rather than a color
              wheel that can land on two categories nobody can tell apart. */}
          <div className="flex items-center gap-1" role="radiogroup" aria-label="Category color">
            {CHART_COLORS.map((option) => (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={color === option}
                aria-label={option}
                title={option}
                onClick={() => setColor(option)}
                style={{ background: option }}
                className={
                  color === option
                    ? 'ring-ring size-5 rounded-[4px] ring-2 ring-offset-2 ring-offset-(--card)'
                    : 'size-5 rounded-[4px]'
                }
              />
            ))}
          </div>
          <Button type="submit" size="sm">
            Add
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
