import { useState } from 'react';
import { type Category, createCategory, deleteCategory } from '@/api';
import { ConfirmDelete } from '@/components/confirm-delete';
import { EmptyState } from '@/components/empty-state';
import { Swatch } from '@/components/rules/swatch';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import type { Run } from '@/hooks/use-query';
import { CHART_COLORS, categoryColor } from '@/lib/palette';

export function CategoriesCard({ categories, run }: { categories: Category[]; run: Run }) {
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
