import { Wand } from 'lucide-react';
import { useState } from 'react';
import {
  type ActivitySample,
  applyCategoryRules,
  assignEntry,
  type Category,
  fetchAppSummary,
  fetchCategories,
  fetchRecentActivities,
} from '@/api';
import { RangePicker } from '@/components/dashboard/range-picker';
import { EmptyState } from '@/components/empty-state';
import { CategoryRuleForm, type RulePatterns } from '@/components/rules/category-rule-form';
import { RuleDialog } from '@/components/rules/rule-dialog';
import { StatusLine } from '@/components/status-line';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { type Run, useAction, useQuery } from '@/hooks/use-query';
import { type DateRange, formatSeconds, rangeOfLastDays } from '@/lib/format';
import { escapeRegex } from '@/lib/pattern';
import { type QueueEntry, sumSeconds, uncategorizedEntries } from '@/lib/summary';

// The review queue: what the recorder saw that nothing has labelled yet, biggest
// first, with the two ways to label it one click away. Assigning settles this
// entry over this window; a rule settles it for good, including time that
// hasn't been recorded yet.
//
// A window rather than all of history, like the dashboard it feeds: the useful
// question is "what is my last month missing", and an app last opened in 2024
// is not worth a rule. Thirty days by default for the same reason — long
// enough that the queue reflects habits rather than one afternoon.

const label = (entry: QueueEntry): string =>
  entry.context ? `${entry.app} / ${entry.context}` : entry.app;

/**
 * The rule a queue entry suggests: this app, and this context when it has one,
 * matched exactly. Exact rather than "contains" so the preview starts from the
 * entry itself; widening it is one mode change in the editor.
 */
const draftFor = (entry: QueueEntry): RulePatterns => ({
  appPattern: `^${escapeRegex(entry.app)}$`,
  titlePattern: null,
  contextPattern: entry.context ? `^${escapeRegex(entry.context)}$` : null,
});

export function ReviewView() {
  const [range, setRange] = useState<DateRange>(() => rangeOfLastDays(30));
  const { data, error, loading, reload } = useQuery(
    () =>
      Promise.all([
        fetchAppSummary(range.from, range.to),
        fetchCategories(),
        // The rule editor's preview corpus, as on the rules view: losing it
        // costs the preview, not the queue.
        fetchRecentActivities().catch((): ActivitySample[] => []),
      ]),
    [range.from, range.to],
  );
  const action = useAction();

  const run: Run = (mutation) => action.run(mutation, { onDone: reload });

  return (
    <div className="flex flex-col gap-6">
      <RangePicker range={range} onChange={setRange} />
      {error ? (
        <p className="text-destructive text-sm">{error}</p>
      ) : !data ? null : (
        <div className={loading ? 'opacity-60 transition-opacity' : undefined}>
          <Queue
            entries={uncategorizedEntries(data[0])}
            categories={[...data[1]].sort((a, b) => a.name.localeCompare(b.name))}
            samples={data[2]}
            range={range}
            run={run}
            onRuleSaved={() =>
              // Rules only categorize pings as they arrive, so a rule made
              // here would leave the very entry it was made from sitting in
              // the queue. Sweep history straight away instead.
              action.run(applyCategoryRules, {
                onDone: reload,
                success: 'Rule added and applied to recorded activity.',
              })
            }
            busy={action.pending}
          />
        </div>
      )}
      <StatusLine status={action.status} />
    </div>
  );
}

interface QueueProps {
  entries: QueueEntry[];
  categories: Category[];
  samples: ActivitySample[];
  range: DateRange;
  run: Run;
  onRuleSaved(): void;
  busy: boolean;
}

function Queue({ entries, categories, samples, range, run, onRuleSaved, busy }: QueueProps) {
  const total = sumSeconds(entries);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Uncategorized time</CardTitle>
        <CardDescription>
          {entries.length === 0
            ? 'Everything recorded in this range has a category.'
            : `${formatSeconds(total)} across ${entries.length} ${entries.length === 1 ? 'entry' : 'entries'}, largest first. Assigning labels this range's time by hand; a rule also catches it from now on.`}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {entries.length > 0 && categories.length === 0 && (
          <EmptyState>
            Create a category under Categories &amp; rules first, then come back to sort this time
            into it.
          </EmptyState>
        )}
        {entries.length === 0 && <EmptyState>Nothing to review.</EmptyState>}
        <ul className="flex flex-col">
          {entries.map((entry) => (
            <li
              key={`${entry.app}\n${entry.context ?? ''}`}
              className="flex flex-wrap items-center gap-2 border-b border-dashed py-1.5 last:border-0"
            >
              <span className="min-w-0 grow truncate text-sm" title={label(entry)}>
                {entry.app}
                {entry.context ? (
                  <span className="text-muted-foreground"> / {entry.context}</span>
                ) : null}
              </span>
              <span className="text-muted-foreground w-16 shrink-0 text-right font-mono text-xs tabular-nums">
                {formatSeconds(entry.seconds)}
              </span>
              {/* Picking a category IS the assignment — no confirm step, since
                  the row leaves the queue and the time shows up under the
                  category on the dashboard, where it can be moved again. */}
              <Select
                value=""
                disabled={categories.length === 0 || busy}
                onValueChange={(categoryId) => run(() => assignEntry(entry, categoryId, range))}
              >
                <SelectTrigger className="w-40" size="sm" aria-label={`Assign ${label(entry)}`}>
                  <SelectValue placeholder="Assign to…" />
                </SelectTrigger>
                <SelectContent>
                  {categories.map((category) => (
                    <SelectItem key={category.id} value={category.id}>
                      {category.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <RuleDialog
                title="New category rule"
                description={`Starts from ${label(entry)}. Saving applies it to recorded activity too.`}
                trigger={
                  <Button
                    variant="outline"
                    size="sm"
                    aria-label={`Create a rule from ${label(entry)}`}
                    disabled={categories.length === 0}
                  >
                    <Wand className="size-4" />
                    Create rule
                  </Button>
                }
              >
                {(close) => (
                  <CategoryRuleForm
                    categories={categories}
                    samples={samples}
                    draft={draftFor(entry)}
                    onSaved={() => {
                      close();
                      onRuleSaved();
                    }}
                  />
                )}
              </RuleDialog>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
