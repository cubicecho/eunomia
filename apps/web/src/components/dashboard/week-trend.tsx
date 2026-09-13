import { fetchSummary } from '@/api';
import { EmptyState } from '@/components/empty-state';
import { Swatch } from '@/components/rules/swatch';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useQuery } from '@/hooks/use-query';
import { dayIn, formatSeconds } from '@/lib/format';
import { compareWeeks, type Delta, type DeltaRow, weeksSpan, weekWindows } from '@/lib/trends';
import { cn } from '@/lib/utils';

interface Props {
  timeZone: string;
  deviceId: string | null;
}

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/**
 * This week against last, independent of the range picker — "compared with
 * last week" only means something for a fixed pair of weeks. It does follow
 * the device filter, so the comparison is always of the same thing the rest of
 * the page shows. One query covers both weeks; lib/trends.ts splits it.
 */
export function WeekTrend({ timeZone, deviceId }: Props) {
  // Recomputed per render, not memoized: the page stays open across midnight
  // and on Monday the windows have to move with it.
  const windows = weekWindows(dayIn(new Date(), timeZone));
  const span = weeksSpan(windows);
  const { data, error } = useQuery(
    () => fetchSummary(span.from, span.to, deviceId),
    [span.from, span.to, deviceId],
  );

  const through = WEEKDAYS[windows.days - 1];
  const comparison = data ? compareWeeks(data, windows) : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>This week vs last week</CardTitle>
        <CardDescription>
          {windows.days === 7
            ? 'Monday to Sunday, against the whole of last week.'
            : `Monday to ${through}, against last Monday to ${through} — like for like, so a week in progress isn’t measured against a finished one. Today counts in full even though it isn’t over.`}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {error ? (
          <p className="text-destructive text-sm">{error}</p>
        ) : !comparison ? (
          <p className="text-muted-foreground text-sm">Loading…</p>
        ) : comparison.total.current === 0 && comparison.total.previous === 0 ? (
          <EmptyState>No activity either week yet.</EmptyState>
        ) : (
          <>
            <div className="flex items-baseline justify-between gap-3">
              <div>
                <div className="font-mono text-2xl tabular-nums">
                  {formatSeconds(comparison.total.current)}
                </div>
                <div className="text-muted-foreground text-xs">
                  last week {formatSeconds(comparison.total.previous)}
                </div>
              </div>
              <Change delta={comparison.total} />
            </div>
            <Section title="By kind" rows={comparison.kinds} />
            <Section title="By category" rows={comparison.categories} />
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Section({ title, rows }: { title: string; rows: DeltaRow[] }) {
  if (rows.length === 0) return null;
  return (
    <div className="flex flex-col gap-1">
      <div className="text-muted-foreground grid grid-cols-[1fr_4rem_4rem_6rem] gap-2 text-xs">
        <span>{title}</span>
        <span className="text-right">This</span>
        <span className="text-right">Last</span>
        <span className="text-right">Change</span>
      </div>
      <ul className="flex flex-col gap-1">
        {rows.map((row) => (
          <li
            key={row.key}
            className="grid grid-cols-[1fr_4rem_4rem_6rem] items-center gap-2 text-sm"
          >
            <span className="flex min-w-0 items-center gap-2">
              <Swatch color={row.color} />
              <span className="truncate" title={row.label}>
                {row.label}
              </span>
            </span>
            <span className="text-right font-mono text-xs tabular-nums">
              {formatSeconds(row.current)}
            </span>
            <span className="text-muted-foreground text-right font-mono text-xs tabular-nums">
              {formatSeconds(row.previous)}
            </span>
            <Change delta={row} />
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The change in time, plus a percentage when last week had anything to be a
 * percentage of. Deliberately uncolored: more time is good news for a focus
 * category and bad news for a distracting one, so green/red would lie half the
 * time — the sign says which way it went, the kind says whether that's welcome.
 */
function Change({ delta }: { delta: Delta }) {
  const sign = delta.change > 0 ? '+' : delta.change < 0 ? '−' : '±';
  const percent =
    delta.ratio === null ? 'new' : `${delta.ratio > 0 ? '+' : ''}${Math.round(delta.ratio * 100)}%`;
  return (
    <span
      className={cn(
        'text-right font-mono text-xs tabular-nums',
        delta.change === 0 && 'text-muted-foreground',
      )}
    >
      {sign}
      {formatSeconds(Math.abs(delta.change))}
      <span className="text-muted-foreground block">
        {delta.previous === 0 && delta.current === 0 ? '' : percent}
      </span>
    </span>
  );
}
