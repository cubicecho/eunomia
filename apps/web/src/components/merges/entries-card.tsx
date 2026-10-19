import { ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { CardLayout } from '@/components/card-layout';
import { EmptyState } from '@/components/empty-state';
import { MergeDialog } from '@/components/merges/merge-dialog';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Input } from '@/components/ui/input';
import { formatSeconds } from '@/lib/format';
import type { EntryGroup } from '@/lib/summary';
import { cn } from '@/lib/utils';

interface Props {
  /** Everything recorded, largest first. */
  groups: EntryGroup[];
  /** Called once a merge lands. */
  reload(): void;
}

const contains = (haystack: string, needle: string) =>
  haystack.toLowerCase().includes(needle.toLowerCase());

/**
 * The inventory: every name the user's activity has been recorded under, with
 * a merge on each. Everything ever recorded, not a top ten — the entry someone
 * came here to fix is by definition one they don't want in the chart, which is
 * usually the small one.
 *
 * Hence the filter: this list is as long as the user's history is varied, and
 * the entry they mean is one they can already name.
 */
export function EntriesCard({ groups, reload }: Props) {
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());

  const needle = query.trim();
  const shown = needle
    ? groups.filter(
        (group) =>
          contains(group.app, needle) ||
          group.contexts.some((entry) => contains(entry.context, needle)),
      )
    : groups;

  return (
    <CardLayout
      title="Recorded entries"
      description="Every app and context your devices have reported. Merging one into another rewrites the time already recorded under it and folds future pings the same way — the fix for one thing arriving under two names."
      contentClassName="gap-3"
      contentSlot={
        <>
          <Input
            className="w-full sm:w-72"
            placeholder="Filter apps and contexts"
            aria-label="Filter entries"
            value={query}
            onChange={(event) => {
              const next = event.target.value;
              setQuery(next);
              // Typing a context should show it, not just the app hiding it.
              const term = next.trim();
              setExpanded(
                new Set(
                  term
                    ? groups
                        .filter((group) =>
                          group.contexts.some((entry) => contains(entry.context, term)),
                        )
                        .map((group) => group.app)
                    : [],
                ),
              );
            }}
          />
          {groups.length === 0 && <EmptyState compact title="Nothing recorded yet." />}
          {groups.length > 0 && shown.length === 0 && (
            <EmptyState compact title={`No entry matches “${needle}”.`} />
          )}
          {shown.map((group) => (
            <AppRow
              key={group.app}
              group={group}
              groups={groups}
              open={expanded.has(group.app)}
              onOpenChange={(open) =>
                setExpanded((current) => {
                  const next = new Set(current);
                  if (open) next.add(group.app);
                  else next.delete(group.app);
                  return next;
                })
              }
              reload={reload}
            />
          ))}
        </>
      }
    />
  );
}

interface RowProps {
  group: EntryGroup;
  /** Every group, for the dialog's target suggestions. */
  groups: EntryGroup[];
  open: boolean;
  onOpenChange(open: boolean): void;
  reload(): void;
}

function AppRow({ group, groups, open, onOpenChange, reload }: RowProps) {
  const expandable = group.contexts.length > 0;

  const header = (
    <div className="flex items-center gap-2 py-1">
      <ChevronRight
        aria-hidden
        className={cn(
          'text-muted-foreground size-3.5 shrink-0 transition-transform',
          !expandable && 'invisible',
          open && 'rotate-90',
        )}
      />
      <span className="grow truncate text-sm" title={group.app}>
        {group.app}
      </span>
      <span className="text-muted-foreground w-16 shrink-0 text-right font-mono text-xs tabular-nums">
        {formatSeconds(group.seconds)}
      </span>
    </div>
  );

  return (
    <div className="border-b border-dashed pb-1 last:border-0">
      <div className="flex items-center gap-1">
        {expandable ? (
          <Collapsible open={open} onOpenChange={onOpenChange} className="grow">
            <CollapsibleTrigger className="hover:bg-muted/40 w-full cursor-pointer rounded-md px-1 text-left transition-colors">
              {header}
            </CollapsibleTrigger>
            <CollapsibleContent className="flex flex-col gap-0.5 pb-1 pl-6">
              {group.contexts.map((entry) => (
                <ContextRow
                  key={entry.context}
                  app={group.app}
                  context={entry.context}
                  seconds={entry.seconds}
                  groups={groups}
                  reload={reload}
                />
              ))}
              {group.contextless > 0 && (
                // Shown for the arithmetic, without a merge of its own: the
                // only source key that means "this app minus its contexts" is
                // the app-wide rule above, which takes the contexts too.
                <div className="text-muted-foreground flex items-center gap-2 py-1 pr-9 text-xs">
                  <span className="grow truncate italic">no context</span>
                  <span className="w-16 shrink-0 text-right font-mono tabular-nums">
                    {formatSeconds(group.contextless)}
                  </span>
                </div>
              )}
            </CollapsibleContent>
          </Collapsible>
        ) : (
          <div className="grow px-1">{header}</div>
        )}
        <MergeDialog source={{ app: group.app, context: null }} groups={groups} onSaved={reload} />
      </div>
    </div>
  );
}

function ContextRow({
  app,
  context,
  seconds,
  groups,
  reload,
}: {
  app: string;
  context: string;
  seconds: number;
  groups: EntryGroup[];
  reload(): void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-muted-foreground grow truncate text-xs" title={context}>
        {context}
      </span>
      <span className="text-muted-foreground w-16 shrink-0 text-right font-mono text-xs tabular-nums">
        {formatSeconds(seconds)}
      </span>
      <MergeDialog source={{ app, context }} groups={groups} onSaved={reload} />
    </div>
  );
}
