import { Plus, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import {
  type ActivitySample,
  type Category,
  type CategoryRule,
  type CategoryRuleInput,
  createCategoryRule,
  updateCategoryRule,
} from '@/api';
import { MatchField } from '@/components/rules/match-field';
import { Preview, PreviewRow } from '@/components/rules/preview';
import { StatusLine } from '@/components/status-line';
import { Button } from '@/components/ui/button';
import { DialogClose } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useAction } from '@/hooks/use-query';
import { compile, type Match, parsePattern, toPattern } from '@/lib/pattern';

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

let lastId = 0;

/** Row identity, local to this form — the server never sees these. */
const nextId = (): number => {
  lastId += 1;
  return lastId;
};

/** A rule carries at most one pattern per field, so a row per field is the cap. */
type Patterns = Record<Field, string | null>;

const blank = (field: Field): Condition => ({
  id: nextId(),
  field,
  match: { mode: 'contains', value: '' },
});

/**
 * The rule's stored regexes, read back into the modes that wrote them — an edit
 * starts where the author left off rather than in raw-regex mode.
 */
function seedConditions(rule: CategoryRule | undefined): Condition[] {
  if (!rule) return [blank('app')];
  const stored: [Field, string | null][] = [
    ['app', rule.appPattern],
    ['title', rule.titlePattern],
    ['context', rule.contextPattern],
  ];
  const conditions: Condition[] = [];
  for (const [field, pattern] of stored) {
    if (pattern === null) continue;
    conditions.push({ id: nextId(), field, match: parsePattern(pattern) });
  }
  return conditions.length > 0 ? conditions : [blank('app')];
}

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
  /** The rule being edited; omitted when writing a new one. */
  rule?: CategoryRule;
  /** Called once the save lands — the dialog closes and the view reloads. */
  onSaved(): void;
}

/**
 * The whole category rule, create and edit alike: the same conditions, the same
 * preview, and a submit that either inserts or replaces. It runs its own
 * mutation so a rejected pattern is reported next to the field that caused it,
 * inside the dialog, with the draft still intact.
 */
export function CategoryRuleForm({ categories, samples, rule, onSaved }: Props) {
  const first = categories[0];
  const action = useAction();
  const [categoryId, setCategoryId] = useState(rule?.categoryId ?? (first ? first.id : ''));
  const [conditions, setConditions] = useState<Condition[]>(() => seedConditions(rule));
  const [priority, setPriority] = useState(String(rule?.priority ?? 0));

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
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (!valid) return;
        const input: CategoryRuleInput = {
          categoryId,
          appPattern: patterns.app,
          titlePattern: patterns.title,
          contextPattern: patterns.context,
          priority: Number(priority) || 0,
        };
        action.run(() => (rule ? updateCategoryRule(rule.id, input) : createCategoryRule(input)), {
          onDone: onSaved,
        });
      }}
    >
      <fieldset className="flex flex-col gap-2">
        <legend className="text-muted-foreground mb-2 text-sm">
          Categorize an activity when <strong className="text-foreground">all</strong> of these are
          true:
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
                    field.value === condition.field || unused.some((u) => u.value === field.value),
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

      <StatusLine status={action.status} />

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <DialogClose asChild>
          <Button type="button" variant="outline">
            Cancel
          </Button>
        </DialogClose>
        <Button type="submit" disabled={!valid || action.pending}>
          {rule ? 'Save rule' : 'Add rule'}
        </Button>
      </div>
    </form>
  );
}
