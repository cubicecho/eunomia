import { ChevronRight } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { EmptyState } from '@/components/empty-state';
import { Swatch } from '@/components/rules/swatch';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { formatSeconds } from '@/lib/format';
import { UNCATEGORIZED_COLOR } from '@/lib/palette';
import { type AppTotal, appCategories, type Segment } from '@/lib/summary';
import { cn } from '@/lib/utils';

interface Props {
  apps: AppTotal[];
}

/**
 * A bar list rather than a chart: the labels are long, arbitrary strings and
 * the interesting comparison is each app against the biggest one. Sub-bars sit
 * on the SAME scale as their app bar, so a context's share of its app is
 * readable as a length, not a percentage anyone has to compute.
 *
 * Every bar is split into its categories, in the color each category wears
 * everywhere else. An app is not itself a category — a browser is Work on one
 * site and not on the next — so a single color per bar would have to pick a
 * winner and paint over the split; segments show it instead.
 */
export function TopApps({ apps }: Props) {
  if (apps.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Top apps</CardTitle>
        </CardHeader>
        <CardContent>
          <EmptyState>No activity in this range.</EmptyState>
        </CardContent>
      </Card>
    );
  }

  // One shared scale so sub-bars stay comparable to their app bar.
  const max = Math.max(...apps.map((app) => app.seconds));
  const legend = appCategories(apps);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Top apps</CardTitle>
        <CardDescription>
          Expand an app to see its contexts — the site, project, or file it was spent in.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-1">
        {/* The bars carry color, so the card has to say what the colors mean
            without leaning on the category chart beside it — which is a
            separate card, and below rather than beside it on a narrow screen. */}
        <ul className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1">
          {legend.map((category) => (
            <li
              key={category.id ?? 'uncategorized'}
              className="text-muted-foreground flex items-center gap-1.5 text-xs"
            >
              <Swatch color={category.color} />
              {category.name}
            </li>
          ))}
        </ul>
        {apps.map((app) => (
          <AppRow key={app.name} app={app} max={max} />
        ))}
      </CardContent>
    </Card>
  );
}

function AppRow({ app, max }: { app: AppTotal; max: number }) {
  const [open, setOpen] = useState(false);
  const expandable = app.contexts.length > 0;

  const bar = (
    <Bar
      name={app.name}
      seconds={app.seconds}
      segments={app.segments}
      max={max}
      icon={
        expandable ? (
          <ChevronRight
            aria-hidden
            className={cn('size-3.5 shrink-0 transition-transform', open && 'rotate-90')}
          />
        ) : null
      }
    />
  );

  if (!expandable) return <div className="px-1 py-1">{bar}</div>;

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="hover:bg-muted/40 w-full cursor-pointer rounded-md px-1 py-1 text-left transition-colors">
        {bar}
      </CollapsibleTrigger>
      <CollapsibleContent className="flex flex-col gap-1 pt-1 pb-2 pl-5">
        {app.contexts.map((context) => (
          <Bar
            key={context.name}
            name={context.name}
            seconds={context.seconds}
            segments={context.segments}
            max={max}
            small
          />
        ))}
      </CollapsibleContent>
    </Collapsible>
  );
}

interface BarProps {
  name: string;
  seconds: number;
  segments: Segment[];
  max: number;
  icon?: ReactNode;
  small?: boolean;
}

function Bar({ name, seconds, segments, max, icon, small = false }: BarProps) {
  // A bar whose seconds all rounded away below the segment floor still has a
  // length to draw; it just has no category to name.
  const parts: Segment[] =
    segments.length > 0
      ? segments
      : [{ id: null, name: 'Uncategorized', color: UNCATEGORIZED_COLOR, seconds }];

  return (
    <div className="grid grid-cols-[minmax(0,7rem)_1fr_auto] items-center gap-3 sm:grid-cols-[minmax(0,11rem)_1fr_auto]">
      <span
        className={cn(
          'flex items-center gap-1 truncate text-sm',
          small && 'text-muted-foreground text-xs',
        )}
        title={name}
      >
        {icon}
        <span className="truncate">{name}</span>
      </span>
      <div className={cn('bg-muted/50 rounded-sm', small ? 'h-2' : 'h-3.5')}>
        {/* Segments grow in proportion to their seconds, separated by a gap of
            card surface so two adjacent hues never read as one blend. */}
        <div
          className="flex h-full gap-[2px] overflow-hidden rounded-r-[4px]"
          style={{ width: `${Math.max(1, (seconds / max) * 100)}%` }}
        >
          {parts.map((part) => (
            <div
              key={part.id ?? 'uncategorized'}
              title={`${part.name} — ${formatSeconds(part.seconds)}`}
              style={{ flex: `${part.seconds} 0 0`, background: part.color }}
            />
          ))}
        </div>
      </div>
      <span
        className={cn(
          'text-muted-foreground w-16 text-right font-mono text-xs tabular-nums',
          !small && 'text-foreground',
        )}
      >
        {formatSeconds(seconds)}
      </span>
    </div>
  );
}
