import { Trash2 } from 'lucide-react';
import { useState } from 'react';
import { type AppPurge, fetchAppSummary, purgeApp } from '@/api';
import { ConfirmDelete } from '@/components/confirm-delete';
import { StatusLine } from '@/components/status-line';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAction, useQuery } from '@/hooks/use-query';
import { rangeOfEverything } from '@/lib/format';
import { allEntries } from '@/lib/summary';
import { useTimeZone } from '@/session';

// "Forget I ever used this" (Mutation.purgeApp). Names are offered from
// everything recorded, the way the merge view lists them, because the server
// matches the name as the dashboard shows it — after context and merge rules —
// and a name typed from memory is easy to get subtly wrong.

export function PurgeAppCard() {
  const timeZone = useTimeZone();
  const entries = useQuery(() => {
    const range = rangeOfEverything(timeZone);
    return fetchAppSummary(range.from, range.to).then(allEntries);
  }, [timeZone]);
  const action = useAction();
  const [app, setApp] = useState('');
  const [context, setContext] = useState('');
  const [result, setResult] = useState<AppPurge | null>(null);

  const name = app.trim();
  const site = context.trim();
  const contexts = entries.data?.find((entry) => entry.app === name)?.contexts ?? [];
  const label = site ? `${name} — ${site}` : name;

  const confirm = () => {
    setResult(null);
    action.run(
      async () => {
        setResult(await purgeApp(name, site || null));
        setApp('');
        setContext('');
      },
      { success: `Deleted ${label}.`, onDone: entries.reload },
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Delete an app</CardTitle>
        <CardDescription>
          Removes every trace of an app — or of one site or context within it — from every device
          and every day, including daily totals kept past raw history. It doesn't stop the app being
          recorded from now on: add it to the agent's ignored apps for that.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(event) => event.preventDefault()}
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="purge-app">App</Label>
            <Input
              id="purge-app"
              className="w-56"
              list="purge-apps"
              placeholder="e.g. firefox"
              value={app}
              onChange={(event) => setApp(event.target.value)}
            />
            <datalist id="purge-apps">
              {entries.data?.map((entry) => (
                <option key={entry.app} value={entry.app} />
              ))}
            </datalist>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="purge-context">Context (optional)</Label>
            <Input
              id="purge-context"
              className="w-56"
              list="purge-contexts"
              placeholder="the whole app"
              value={context}
              onChange={(event) => setContext(event.target.value)}
            />
            <datalist id="purge-contexts">
              {contexts.map((entry) => (
                <option key={entry.context} value={entry.context} />
              ))}
            </datalist>
          </div>
          <ConfirmDelete
            name={label}
            description={
              site
                ? `Everything recorded in ${name} under ${site} is deleted from every device, for good. The rest of ${name} stays.`
                : `Everything recorded in ${name}, under any context, is deleted from every device, for good.`
            }
            onConfirm={confirm}
          >
            <Button variant="destructive" disabled={!name || action.pending}>
              <Trash2 className="size-4" />
              Delete app
            </Button>
          </ConfirmDelete>
        </form>
        <StatusLine status={action.status} />
        {result && (
          <p className="text-muted-foreground text-sm">
            {result.pings.toLocaleString()} pings, {result.activities.toLocaleString()} activities
            and {result.summaries.toLocaleString()} daily totals removed.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
