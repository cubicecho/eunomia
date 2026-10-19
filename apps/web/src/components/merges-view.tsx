import { fetchAppSummary, fetchMergeRules } from '@/api';
import { EntriesCard } from '@/components/merges/entries-card';
import { MergesCard } from '@/components/merges/merges-card';
import { QueryError, RowSkeleton } from '@/components/query-state';
import { StatusLine } from '@/components/status-line';
import { useAction, useQuery } from '@/hooks/use-query';
import { rangeOfEverything } from '@/lib/format';
import { allEntries } from '@/lib/summary';
import { useTimeZone } from '@/session';

// The third thing this dashboard can do to a recording after the fact:
// categories label time, context rules divide it, and a merge renames it.
// Between them there is nothing left that needs a hand on the database.
//
// Over all of history rather than the dashboard's window, deliberately: an
// entry recorded under a name that has since been fixed at the agent stops
// appearing, and that is exactly the one a user comes here to clean up.

export function MergesView() {
  const timeZone = useTimeZone();
  const { data, error, reload, refetch } = useQuery(() => {
    const range = rangeOfEverything(timeZone);
    return Promise.all([fetchAppSummary(range.from, range.to), fetchMergeRules()]);
  }, [timeZone]);
  const action = useAction();

  if (error && !data)
    return <QueryError error={error} onRetry={refetch} what="your recorded entries" />;
  if (!data) return <RowSkeleton rows={3} />;
  const [rows, rules] = data;
  const run = (mutation: () => Promise<unknown>) => action.run(mutation, { onDone: reload });

  return (
    <div className="flex flex-col gap-6">
      <EntriesCard groups={allEntries(rows)} reload={reload} />
      <MergesCard rules={rules} run={run} />
      <StatusLine status={action.status} />
      <p className="text-muted-foreground text-sm">
        Category rules match on app names, so a merge that renames one can change what they catch.
        Re-run <span className="text-foreground">Apply rules</span> under Categories &amp; rules if
        the split looks off afterwards.
      </p>
    </div>
  );
}
