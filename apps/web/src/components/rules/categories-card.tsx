import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useId, useState } from 'react';
import {
  type Category,
  type CategoryKind,
  createCategory,
  deleteCategory,
  updateCategory,
} from '@/api';
import { CardLayout } from '@/components/card-layout';
import { ConfirmButton } from '@/components/confirm-button';
import { DialogLayout } from '@/components/dialog-layout';
import { EmptyState } from '@/components/empty-state';
import { FormField } from '@/components/form-field';
import { ColorPicker } from '@/components/rules/color-picker';
import { KindHints, KindPicker } from '@/components/rules/kind-picker';
import { Swatch } from '@/components/rules/swatch';
import { StatusLine } from '@/components/status-line';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { type Run, useAction } from '@/hooks/use-query';
import { DEFAULT_KIND, kindInfo } from '@/lib/kinds';
import { CHART_COLORS, categoryColor } from '@/lib/palette';

interface Props {
  categories: Category[];
  run: Run;
  /** Called once an edit lands — the edit dialog runs its own mutation. */
  reload(): void;
}

export function CategoriesCard({ categories, run, reload }: Props) {
  const [name, setName] = useState('');
  const [color, setColor] = useState<string>(CHART_COLORS[0]);
  const [kind, setKind] = useState<CategoryKind>(DEFAULT_KIND);

  return (
    <CardLayout
      title="Categories"
      description="A category’s kind — focus, work, neutral, personal or distracting — is what the dashboard’s time-by-kind and weekly trends add up. Deleting a category keeps its activities — they go back to uncategorized."
      contentClassName="gap-3"
      contentSlot={
        <>
          {categories.length === 0 ? (
            <EmptyState compact title="No categories yet." />
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
                    <span className="text-muted-foreground text-xs">
                      {kindInfo(category.kind).label}
                    </span>
                    <EditCategory category={category} onSaved={reload} />
                    <ConfirmButton
                      variant="outline"
                      size="icon-sm"
                      aria-label={`Delete ${category.name}`}
                      hint={`Delete ${category.name}`}
                      iconSlot={<Trash2 />}
                      title={`Delete “${category.name}”?`}
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
