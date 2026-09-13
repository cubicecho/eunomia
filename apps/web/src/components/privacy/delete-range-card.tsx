import { CircleAlert, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { deleteRange, fetchDevices, type RangeDeletion } from '@/api';
import { ConfirmDelete } from '@/components/confirm-delete';
import { StatusLine } from '@/components/status-line';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useAction, useQuery } from '@/hooks/use-query';
import { dayIn, instantIn, localIn } from '@/lib/format';
import { useTimeZone } from '@/session';

// "Delete what I did between these two times" (Mutation.deleteRange). The
// inputs are wall-clock times in the user's zone — the zone every chart counts
// days in — and only become instants on the way out.

/** The select's value for "every device": a device id is never this. */
const ALL = 'all';

/**
 * The common cases, relative to the moment they are clicked: someone reaching
 * for this usually wants to remove what just happened.
 */
const PRESETS: { label: string; range(now: Date, timeZone: string): [string, string] }[] = [
  { label: 'Last 15 minutes', range: (now, zone) => lastMs(now, zone, 15 * 60_000) },
  { label: 'Last hour', range: (now, zone) => lastMs(now, zone, 60 * 60_000) },
  { label: 'Last 24 hours', range: (now, zone) => lastMs(now, zone, 24 * 60 * 60_000) },
  { label: 'Today', range: (now, zone) => [`${dayIn(now, zone)}T00:00`, nextMinute(now, zone)] },
];

/**
 * The minute after now, as the range's end: the inputs are minute-precise and
 * the end is exclusive, so ending at the current minute would keep whatever
 * was recorded in it.
 */
const nextMinute = (now: Date, zone: string): string =>
  localIn(new Date(now.getTime() + 60_000), zone);

const lastMs = (now: Date, zone: string, ms: number): [string, string] => [
  localIn(new Date(now.getTime() - ms), zone),
  nextMinute(now, zone),
];

const when = (local: string): string => local.replace('T', ' ');

export function DeleteRangeCard() {
  const timeZone = useTimeZone();
  const devices = useQuery(() => fetchDevices(), []);
  const action = useAction();
  const [[from, to], setRange] = useState(() => lastMs(new Date(), timeZone, 60 * 60_000));
  const [deviceId, setDeviceId] = useState(ALL);
  const [result, setResult] = useState<RangeDeletion | null>(null);

  const start = instantIn(from, timeZone);
  const end = instantIn(to, timeZone);
  const valid = !Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime()) && start < end;
  const device = devices.data?.find((candidate) => candidate.id === deviceId);
  const target = device ? `on ${device.name}` : 'on every device';

  const confirm = () => {
    setResult(null);
    action.run(async () => setResult(await deleteRange(start, end, device ? device.id : null)), {
      success: `Deleted ${when(from)} → ${when(to)} ${target}.`,
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Delete a time range</CardTitle>
        <CardDescription>
          Removes everything recorded between two times — raw pings, activities and the daily totals
          built from them — and keeps it deleted if an agent uploads pings from that time later.
          Times are in <span className="text-foreground">{timeZone}</span>.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="bg-muted/50 flex w-fit flex-wrap rounded-lg p-1">
          {PRESETS.map((preset) => (
            <button
              key={preset.label}
              type="button"
              onClick={() => setRange(preset.range(new Date(), timeZone))}
              className="text-muted-foreground hover:text-foreground rounded-md px-3 py-1 text-sm transition-colors"
            >
              {preset.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="delete-from">From</Label>
            <Input
              id="delete-from"
              type="datetime-local"
              className="w-auto"
              value={from}
              onChange={(event) => setRange([event.target.value, to])}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="delete-to">Up to</Label>
            <Input
              id="delete-to"
              type="datetime-local"
              className="w-auto"
              aria-invalid={!valid}
              value={to}
              onChange={(event) => setRange([from, event.target.value])}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="delete-device">Device</Label>
            <Select value={deviceId} onValueChange={setDeviceId}>
              <SelectTrigger id="delete-device" className="w-56">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Every device</SelectItem>
                {devices.data?.map((candidate) => (
                  <SelectItem key={candidate.id} value={candidate.id}>
                    {candidate.name} ({candidate.platform})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <ConfirmDelete
            name={`${when(from)} → ${when(to)}`}
            description={`Everything recorded in this range ${target} is deleted for good. Export it first if you might want it back.`}
            onConfirm={confirm}
          >
            <Button variant="destructive" disabled={!valid || action.pending}>
              <Trash2 className="size-4" />
              Delete range
            </Button>
          </ConfirmDelete>
        </div>
        <p className="text-muted-foreground text-sm">
          Days older than raw history is kept for, and days imported only as daily totals, can't be
          split by the hour: those are deleted when the range covers the whole day, and otherwise
          left as they are.
        </p>
        <StatusLine status={action.status} />
        {result && (
          <p className="text-muted-foreground text-sm">
            {result.pings.toLocaleString()} pings removed from {result.devices}{' '}
            {result.devices === 1 ? 'device' : 'devices'}
            {result.days > 0 &&
              `, and ${result.days} whole ${result.days === 1 ? 'day' : 'days'} cleared outright`}
            .
          </p>
        )}
        {result && result.partialDays.length > 0 && (
          <p className="flex items-start gap-2 text-sm text-amber-700 dark:text-amber-400">
            <CircleAlert className="mt-0.5 size-4 shrink-0" />
            <span>
              {result.partialDays.join(', ')} {result.partialDays.length === 1 ? 'was' : 'were'}{' '}
              only partly in the range and {result.partialDays.length === 1 ? 'has' : 'have'} no raw
              record left to split, so{' '}
              {result.partialDays.length === 1 ? 'its daily total' : 'their daily totals'} may still
              include some of the deleted time. Delete the whole day to remove it.
            </span>
          </p>
        )}
      </CardContent>
    </Card>
  );
}
