import { Merge } from 'lucide-react';
import { useId, useState } from 'react';
import {
  type Category,
  type CategoryKind,
  createCategory,
  deleteCategory,
  mergeCategory,
  updateCategory,
} from '@/api';
import { CardLayout } from '@/components/card-layout';
import { Combobox } from '@/components/combobox';
import { ConfirmButton } from '@/components/confirm-button';
import { DialogLayout } from '@/components/dialog-layout';
import { EmptyState } from '@/components/empty-state';
import { FormField } from '@/components/form-field';
import { ColorPicker } from '@/components/rules/color-picker';
import { KindHints, KindPicker } from '@/components/rules/kind-picker';
import { Swatch } from '@/components/rules/swatch';
import { StatusLine } from '@/components/status-line';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Pencil, Plus, Trash2 } from '@/components/ui/icons';
import { Input } from '@/components/ui/input';
import { type Run, useAction } from '@/hooks/use-query';
import { formatSeconds } from '@/lib/format';
import { DEFAULT_KIND, kindInfo } from '@/lib/kinds';
import { CHART_COLORS, categoryColor } from '@/lib/palette';

/** What hangs off a category: what a delete would lose, and a merge would move. */
export interface CategoryUsage {
  rules: number;
  /** All the time ever filed under it, or null when the totals didn't load. */
  seconds: number | null;
}

const NO_USAGE: CategoryUsage = { rules: 0, seconds: 0 };

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** "3 rules · 12h 30m", or just the rules when the totals didn't load. */
function usageLabel(usage: CategoryUsage): string {
  const rules = plural(usage.rules, 'rule');
  return usage.seconds === null ? rules : `${rules} · ${formatSeconds(usage.seconds)}`;
}

/** What deleting throws away, said plainly enough to choose merge instead. */
function deleteWarning(usage: CategoryUsage): string {
  const lost =
    usage.rules === 0 ? 'It has no rules' : `Its ${plural(usage.rules, 'rule')} are deleted`;
  const time =
    usage.seconds === null
      ? 'the time it holds goes back to uncategorized'
      : usage.seconds === 0
        ? 'it holds no time yet'
        : `its ${formatSeconds(usage.seconds)} go back to uncategorized`;
  return `${lost}, and ${time}. To keep both, merge it into another category instead.`;
}

/**
 * Categories whose names differ only in case ("gaming" and "Gaming"), keyed
 * by id to the other one — almost always the same bucket made twice. New ones
 * are refused by the server; this is for the pairs made before that.
 */
function caseTwins(categories: Category[]): Map<string, Category> {
  const byName = new Map<string, Category[]>();
  for (const category of categories) {
    const key = category.name.toLowerCase();
    byName.set(key, [...(byName.get(key) ?? []), category]);
  }
  const twins = new Map<string, Category>();
  for (const group of byName.values()) {
    if (group.length < 2) continue;
    for (const category of group) twins.set(category.id, group.find((c) => c !== category)!);
  }
  return twins;
}

interface Props {
  categories: Category[];
  /** Rules and time per category id; a missing id has neither. */
  usage: Map<string, CategoryUsage>;
  run: Run;
  /** Called once an edit lands — the edit dialog runs its own mutation. */
  reload(): void;
}

export function CategoriesCard({ categories, usage, run, reload }: Props) {
  const [name, setName] = useState('');
  const [color, setColor] = useState<string>(CHART_COLORS[0]);
  const [kind, setKind] = useState<CategoryKind>(DEFAULT_KIND);
  const twins = caseTwins(categories);

  return (
    <CardLayout
      title="Categories"
      description="A category’s kind — focus, work, neutral, personal or distracting — is what the dashboard’s time-by-kind and weekly trends add up. Merge one category into another to keep its time and rules; deleting sends its time back to uncategorized and drops its rules."
      contentClassName="gap-3"
      contentSlot={
        <>
          {categories.length === 0 ? (
            <EmptyState compact title="No categories yet." />
          ) : (
            <ul className="flex flex-col">
              {[...categories]
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((category) => {
                  const used = usage.get(category.id) ?? NO_USAGE;
                  const twin = twins.get(category.id);
                  return (
                    <li
                      key={category.id}
                      className="flex flex-wrap items-center gap-2 border-b border-dashed py-1.5 last:border-0"
                    >
                      <Swatch color={categoryColor(category.id, category.color)} />
                      <span className="text-sm">{category.name}</span>
                      {twin && <Badge variant="outline">Same as “{twin.name}”</Badge>}
                      <span className="text-muted-foreground grow text-xs">{usageLabel(used)}</span>
                      <span className="text-muted-foreground text-xs">
                        {kindInfo(category.kind).label}
                      </span>
                      <MergeCategory
                        category={category}
                        others={categories.filter((other) => other.id !== category.id)}
                        usage={used}
                        suggested={twin}
                        run={run}
                      />
                      <EditCategory category={category} onSaved={reload} />
                      <ConfirmButton
                        variant="outline"
                        size="icon-sm"
                        aria-label={`Delete ${category.name}`}
                        hint={`Delete ${category.name}`}
                        iconSlot={<Trash2 />}
                        title={`Delete “${category.name}”?`}
                        description={deleteWarning(used)}
                        onConfirm={() => run(() => deleteCategory(category.id))}
                      />
                    </li>
                  );
                })}
            </ul>
          )}
          <form
            className="flex flex-wrap items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (!name.trim()) return;
              run(() => createCategory(name.trim(), color, kind));
              setName('');
              setKind(DEFAULT_KIND);
            }}
          >
            <Input
              className="w-48"
              aria-label="New category name"
              placeholder="new category"
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
            />
            <ColorPicker value={color} onChange={setColor} />
            <KindPicker value={kind} onChange={setKind} />
            <Button type="submit" size="sm" variant="info" iconSlot={<Plus />} content="Add" />
          </form>
        </>
      }
    />
  );
}

/**
 * Folds one category into another: its time, activities and rules move over
 * and it is removed — what someone with "Games" and "Gaming" wants, where
 * deleting one would drop its rules and uncategorize its time.
 */
function MergeCategory({
  category,
  others,
  usage,
  suggested,
  run,
}: {
  category: Category;
  others: Category[];
  usage: CategoryUsage;
  /** The likely target (a same-name twin), picked when the dialog opens. */
  suggested: Category | undefined;
  run: Run;
}) {
  const [open, setOpen] = useState(false);
  const [targetId, setTargetId] = useState('');
  const target = others.find((other) => other.id === targetId);
  const moved =
    usage.seconds === null || usage.seconds === 0
      ? plural(usage.rules, 'rule')
      : `${formatSeconds(usage.seconds)} and ${plural(usage.rules, 'rule')}`;

  return (
    <DialogLayout
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setTargetId(suggested?.id ?? '');
      }}
      triggerSlot={
        <Button
          variant="outline"
          size="icon-sm"
          aria-label={`Merge ${category.name}`}
          disabled={others.length === 0}
          hint={
            others.length === 0
              ? 'Nothing to merge into yet'
              : `Merge ${category.name} into another`
          }
          iconSlot={<Merge />}
        />
      }
      title={`Merge “${category.name}” into another category?`}
      description={`Its ${moved} move to the category you pick, keeping any activities you assigned by hand, and “${category.name}” is removed. The target keeps its own name, color and kind.`}
      contentSlot={
        <Combobox
          aria-label="Merge into"
          placeholder="Merge into…"
          options={[...others]
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((other) => ({ value: other.id, label: other.name }))}
          value={targetId}
          onValueChange={setTargetId}
        />
      }
      footerActionsSlot={(close) => (
        <>
          <Button variant="outline" onClick={close} content="Cancel" />
          <Button
            disabled={!target}
            onClick={() => {
              if (!target) return;
              run(() => mergeCategory(category.id, target.id));
              setOpen(false);
            }}
            content={`Merge into “${target?.name ?? '…'}”`}
          />
        </>
      )}
    />
  );
}

/**
 * Rename, recolor and re-kind in one dialog. Rules, activities and summaries all point at
 * the category's id, so neither edit moves any time — the new name and color
 * simply show up wherever the old ones did.
 *
 * It runs its own mutation, like the rule editors, so a rejected name (blank, or
 * one the user already has) is reported inside the dialog with the draft intact.
 */
function EditCategory({ category, onSaved }: { category: Category; onSaved(): void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(category.name);
  const [color, setColor] = useState<string | null>(category.color);
  const [kind, setKind] = useState<CategoryKind>(category.kind);
  const action = useAction();

  const trimmed = name.trim();
  const changed = trimmed !== category.name || color !== category.color || kind !== category.kind;
  const formId = useId();

  return (
    <DialogLayout
      open={open}
      onOpenChange={(next) => {
        // Every opening starts from the category as it is now, not an
        // abandoned draft from the last one.
        if (next) {
          setName(category.name);
          setColor(category.color);
          setKind(category.kind);
        }
        setOpen(next);
      }}
      triggerSlot={
        <Button
          variant="outline"
          size="icon-sm"
          aria-label={`Edit ${category.name}`}
          hint={`Edit ${category.name}`}
          iconSlot={<Pencil />}
        />
      }
      title={`Edit “${category.name}”`}
      description="Its rules and the time already in it stay with it under the new name."
      hasUnsavedChanges={changed}
      contentSlot={
        <form
          id={formId}
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!trimmed || !changed) return;
            action.run(() => updateCategory(category.id, trimmed, color, kind), {
              onDone: () => {
                setOpen(false);
                onSaved();
              },
            });
          }}
        >
          <FormField
            label="Name"
            required
            controlSlot={
              <Input value={name} onChange={(event) => setName(event.target.value)} required />
            }
          />
          <FormField
            label="Color"
            asGroup
            controlSlot={(wired) => (
              <div {...wired}>
                <ColorPicker value={color} onChange={setColor} />
              </div>
            )}
          />
          <FormField
            label="Kind"
            description={<KindHints />}
            controlSlot={(wired) => (
              <div>
                <KindPicker id={wired.id} value={kind} onChange={setKind} />
              </div>
            )}
          />
          <StatusLine status={action.status} />
        </form>
      }
      footerActionsSlot={(close) => (
        <>
          <Button variant="outline" onClick={close} content="Cancel" />
          <Button
            type="submit"
            form={formId}
            variant="positive"
            disabled={!trimmed || !changed}
            loading={action.pending}
            content="Save"
          />
        </>
      )}
    />
  );
}
