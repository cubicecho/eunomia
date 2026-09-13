import { Pencil } from 'lucide-react';
import { useState } from 'react';
import { type Category, createCategory, deleteCategory, updateCategory } from '@/api';
import { ConfirmDelete } from '@/components/confirm-delete';
import { EmptyState } from '@/components/empty-state';
import { ColorPicker } from '@/components/rules/color-picker';
import { Swatch } from '@/components/rules/swatch';
import { StatusLine } from '@/components/status-line';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { type Run, useAction } from '@/hooks/use-query';
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
                  <EditCategory category={category} onSaved={reload} />
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
          <ColorPicker value={color} onChange={setColor} />
          <Button type="submit" size="sm">
            Add
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

/**
 * Rename and recolor in one dialog. Rules, activities and summaries all point at
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
  const action = useAction();

  const trimmed = name.trim();
  const changed = trimmed !== category.name || color !== category.color;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Every opening starts from the category as it is now, not an
        // abandoned draft from the last one.
        if (next) {
          setName(category.name);
          setColor(category.color);
        }
        setOpen(next);
      }}
    >
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Edit ${category.name}`}
          title={`Edit ${category.name}`}
          className="text-muted-foreground hover:text-foreground size-8"
        >
          <Pencil className="size-4" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit “{category.name}”</DialogTitle>
          <DialogDescription>
            Its rules and the time already in it stay with it under the new name.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!trimmed || !changed) return;
            action.run(() => updateCategory(category.id, trimmed, color), {
              onDone: () => {
                setOpen(false);
                onSaved();
              },
            });
          }}
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`category-name-${category.id}`}>Name</Label>
            <Input
              id={`category-name-${category.id}`}
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Color</Label>
            <ColorPicker value={color} onChange={setColor} />
          </div>
          <StatusLine status={action.status} />
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={!trimmed || !changed || action.pending}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
