import { ArrowRight } from 'lucide-react';
import { useState } from 'react';
import { applyMergeRules, deleteMergeRule, type MergeRule } from '@/api';
import { ConfirmDelete } from '@/components/confirm-delete';
import { EmptyState } from '@/components/empty-state';
import { entryLabel } from '@/components/merges/merge-dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { errorMessage, type Run } from '@/hooks/use-query';

interface Props {
  rules: MergeRule[];
  run: Run;
}

/** The merges in force, and the sweep that belongs to all of them at once. */
export function MergesCard({ rules, run }: Props) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Merges</CardTitle>
        <CardDescription>
          Each one keeps applying, so an agent still reporting the old name lands under the new one
          without anyone watching. An app-wide merge (no context on the left) renames the app and
          carries its contexts across.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {rules.length === 0 ? (
          <EmptyState>
            No merges yet — every name your devices report is charted as its own entry.
          </EmptyState>
        ) : (
          <ul className="flex flex-col">
            {rules.map((rule) => {
              const from = entryLabel({ app: rule.fromApp, context: rule.fromContext });
              const to = entryLabel({ app: rule.toApp, context: rule.toContext });
              return (
                <li
                  key={rule.id}
                  className="flex items-center gap-2 border-b border-dashed py-1.5 last:border-0"
                >
                  <span className="min-w-0 grow truncate text-sm" title={`${from} → ${to}`}>
                    {from}
                    <ArrowRight
                      aria-label="becomes"
                      className="mx-1.5 inline size-3.5 align-[-2px]"
                    />
                    <span className="font-medium">{to}</span>
                  </span>
                  <ConfirmDelete
                    name={`${from} → ${to}`}
                    description="New pings go back to folding under the old name. Time already merged stays merged — the two names were folded into one entry and nothing records which seconds came from which."
                    onConfirm={() => run(() => deleteMergeRule(rule.id))}
                  />
                </li>
              );
            })}
          </ul>
        )}
        <ApplyMerges />
      </CardContent>
    </Card>
  );
}

/**
 * Creating a merge already sweeps history, so this is for what creation can't
 * cover: activity that arrived afterwards, from a device that was offline or
 * an agent still reporting the old name.
 *
 * Its own state rather than the view's — reporting a count is not the same
 * shape as reporting a failure, and it doesn't change what the cards show.
 */
function ApplyMerges() {
  const [applying, setApplying] = useState(false);
  const [applied, setApplied] = useState<string | null>(null);

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button
        variant="outline"
        size="sm"
        disabled={applying}
        onClick={() => {
          setApplying(true);
          applyMergeRules()
            .then((changed) =>
              setApplied(`Rewrote ${changed} ${changed === 1 ? 'activity' : 'activities'}.`),
            )
            .catch((cause: unknown) => setApplied(errorMessage(cause)))
            .finally(() => setApplying(false));
        }}
      >
        Apply merges to existing activities
      </Button>
      {applied && <span className="text-muted-foreground text-sm">{applied}</span>}
    </div>
  );
}
