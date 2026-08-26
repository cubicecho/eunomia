import { Plus, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { type ActivitySample, applyCategoryRules, type Category, createCategoryRule } from '@/api';
import { MatchField } from '@/components/rules/match-field';
import { Preview, PreviewRow } from '@/components/rules/preview';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { errorMessage } from '@/hooks/use-query';
import { compile, type Match, toPattern } from '@/lib/pattern';

type Field = 'app' | 'title' | 'context';

const FIELDS: { value: Field; label: string }[] = [
  { value: 'app', label: 'App' },
  { value: 'title', label: 'Title' },
  { value: 'context', label: 'Context' },
];

interface Condition {
  /** Stable across reorders so React keeps each row's input focused. */
  id: number;
  field: Field;
  match: Match;
}

let nextId = 0;

/** A rule carries at most one pattern per field, so a row per field is the cap. */
type Patterns = Record<Field, string | null>;

const blank = (field: Field): Condition => ({
  id: (nextId += 1),
  field,
  match: { mode: 'contains', value: '' },
});

function patternsOf(conditions: Condition[]): Patterns {
  const patterns: Patterns = { app: null, title: null, context: null };
  for (const condition of conditions) {
    if (condition.match.value.trim() === '') continue;
    patterns[condition.field] = toPattern(condition.match);
  }
  return patterns;
}

/**
 * Same test the resolver runs (`matchRule`): every pattern the rule carries has
 * to match, and a title or context pattern never matches an activity that
 * doesn't have one.
 */
function matches(sample: ActivitySample, compiled: Record<Field, RegExp | null>): boolean {
  if (compiled.app && !compiled.app.test(sample.app)) return false;
  if (compiled.title && (sample.title === null || !compiled.title.test(sample.title))) return false;
  if (compiled.context && (sample.context === null || !compiled.context.test(sample.context))) {
    return false;
  }
  return true;
}

interface Props {
  categories: Category[];
  samples: ActivitySample[];
  run(mutation: () => Promise<unknown>): void;
}

export function CategoryRuleForm({ categories, samples, run }: Props) {
  const first = categories[0];
  const [categoryId, setCategoryId] = useState(first ? first.id : '');
  const [conditions, setConditions] = useState<Condition[]>([blank('app')]);
  const [priority, setPriority] = useState('0');
  const [applying, setApplying] = useState(false);
  const [applied, setApplied] = useState<string | null>(null);

  const patterns = patternsOf(conditions);
  const filled = FIELDS.map((field) => patterns[field.value]).filter((p) => p !== null);
  const compiled = useMemo(
    () => ({
      app: patterns.app === null ? null : compile(patterns.app),
      title: patterns.title === null ? null : compile(patterns.title),
      context: patterns.context === null ? null : compile(patterns.context),
    }),
    [patterns.app, patterns.title, patterns.context],
  );
  const broken = filled.length > 0 && FIELDS.some((f) => patterns[f.value] && !compiled[f.value]);
  const valid = categoryId !== '' && filled.length > 0 && !broken;

  const hits = useMemo(
    () => (valid ? samples.filter((sample) => matches(sample, compiled)) : []),
    [valid, samples, compiled],
  );

  const unused = FIELDS.filter((field) => !conditions.some((c) => c.field === field.value));
  const update = (index: number, condition: Condition) =>
    setConditions((current) => current.map((c, i) => (i === index ? condition : c)));

  return (
    <div className="flex flex-col gap-4">
      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (!valid) return;
          run(() =>
            createCategoryRule({
              categoryId,
              appPattern: patterns.app,
              titlePattern: patterns.title,
              contextPattern: patterns.context,
              priority: Number(priority) || 0,
            }),
          );
          setConditions([blank('app')]);
        }}
      >
        <fieldset className="flex flex-col gap-2">
          <legend className="text-muted-foreground mb-2 text-sm">
            Categorize an activity when <strong className="text-foreground">all</strong> of these
            are true:
          </legend>
          {conditions.map((condition, index) => (
            <div key={condition.id} className="flex flex-wrap items-start gap-2">
              <Select
                value={condition.field}
                onValueChange={(field) => update(index, { ...condition, field: field as Field })}
              >
                <SelectTrigger className="w-28" aria-label="Field">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FIELDS.filter(
                    (field) =>
                      field.value === condition.field ||
                      unused.some((u) => u.value === field.value),
                  ).map((field) => (
                    <SelectItem key={field.value} value={field.value}>
                      {field.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <MatchField
                label={FIELDS.find((f) => f.value === condition.field)?.label ?? 'value'}
                value={condition.match}
                onChange={(match) => update(index, { ...condition, match })}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Remove condition"
                className="text-muted-foreground hover:text-destructive size-9"
                disabled={conditions.length === 1}
                onClick={() => setConditions((current) => current.filter((_, i) => i !== index))}
              >
                <X className="size-4" />
              </Button>
            </div>
          ))}
          {unused.length > 0 && unused[0] && (
            <div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  setConditions((current) => [...current, blank(unused[0]?.value ?? 'title')])
                }
              >
                <Plus className="size-4" />
                Add condition
              </Button>
            </div>
          )}
        </fieldset>

        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="rule-category">Category</Label>
            <Select value={categoryId} onValueChange={setCategoryId}>
              <SelectTrigger className="w-40" id="rule-category">
                <SelectValue placeholder="Category" />
              </SelectTrigger>
              <SelectContent>
                {categories.map((category) => (
                  <SelectItem key={category.id} value={category.id}>
                    {category.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="rule-priority">Priority</Label>
            <Input
              id="rule-priority"
              type="number"
              className="w-20"
              value={priority}
              onChange={(event) => setPriority(event.target.value)}
            />
          </div>
          <Button type="submit" disabled={!valid}>
            Add rule
          </Button>
        </div>

        {valid && (
          <Preview total={samples.length} count={hits.length} noun={['activity', 'activities']}>
            {hits.slice(0, 5).map((sample, index) => (
              <PreviewRow key={`${index}-${sample.app}`}>
                {sample.app}
                {sample.context ? ` · ${sample.context}` : ''}
                {sample.title ? ` — ${sample.title}` : ''}
              </PreviewRow>
            ))}
          </Preview>
        )}
      </form>

      <div className="flex flex-wrap items-center gap-3 border-t pt-3">
        <Button
          variant="outline"
          size="sm"
          disabled={applying}
          onClick={() => {
            setApplying(true);
            applyCategoryRules()
              .then((changed) =>
                setApplied(`Re-categorized ${changed} ${changed === 1 ? 'activity' : 'activities'}.`),
              )
              .catch((cause: unknown) => setApplied(errorMessage(cause)))
              .finally(() => setApplying(false));
          }}
        >
          Apply rules to existing activities
        </Button>
        {applied && <span className="text-muted-foreground text-sm">{applied}</span>}
      </div>
    </div>
  );
}
