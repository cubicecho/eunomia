import { History } from 'lucide-react';
import { useEffect, useState } from 'react';
import { setRetention } from '@/api';
import { ConfirmDelete } from '@/components/confirm-delete';
import { StatusLine } from '@/components/status-line';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAction } from '@/hooks/use-query';
import { useSession } from '@/session';

// How long raw history is kept (Mutation.setRetention). Only ever shorter than
// the server's ACTIVITY_RETENTION_DAYS — the operator sized the disk for that,
// and a user can't opt out of it.
//
// Daily totals have no setting of their own. They are the only record of days
// past raw retention and of days imported as totals, and a total can't be
// kept for less time than the raw history it's rebuilt from — the next replay
// would put it back. Deleting a range removes them when that's what's wanted.

export function RetentionCard() {
  const { me, setMe } = useSession();
  const action = useAction();
  const [draft, setDraft] = useState(me.retentionDays?.toString() ?? '');
  useEffect(() => setDraft(me.retentionDays?.toString() ?? ''), [me.retentionDays]);

  const days = Number(draft);
  const valid = draft.trim() !== '' && Number.isInteger(days) && days >= 1;
  const kept =
    me.effectiveRetentionDays === null
      ? 'forever'
      : `for ${me.effectiveRetentionDays} ${me.effectiveRetentionDays === 1 ? 'day' : 'days'}`;

  const save = (value: number | null) =>
    action.run(async () => setMe(await setRetention(value)), {
      success:
        value === null ? "Following the server's retention." : `Keeping raw history ${value} days.`,
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Retention</CardTitle>
        <CardDescription>
          Raw pings and activities are kept <span className="text-foreground">{kept}</span>
          {me.retentionDays === null && ", the server's setting"}. After that only daily totals
          remain — enough for the charts, not for window titles or time of day.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(event) => event.preventDefault()}
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="retention-days">Keep raw history for (days)</Label>
            <Input
              id="retention-days"
              className="w-40"
              type="number"
              min={1}
              step={1}
              max={me.retentionDays === null ? (me.effectiveRetentionDays ?? undefined) : undefined}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
            />
          </div>
          <ConfirmDelete
            name={`raw history older than ${days} ${days === 1 ? 'day' : 'days'}`}
            description="Within the next 15 minutes, pings and activities older than this are deleted for good, on every device. Daily totals stay. Export first if you might want them."
            onConfirm={() => save(days)}
          >
            <Button disabled={!valid || days === me.retentionDays || action.pending}>
              <History className="size-4" />
              Save
            </Button>
          </ConfirmDelete>
          <Button
            type="button"
            variant="ghost"
            disabled={me.retentionDays === null || action.pending}
            onClick={() => save(null)}
          >
            Follow the server's
          </Button>
        </form>
        <StatusLine status={action.status} />
      </CardContent>
    </Card>
  );
}
