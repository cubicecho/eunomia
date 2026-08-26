import { ChevronRight } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { EmptyState } from '@/components/empty-state';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { formatSeconds } from '@/lib/format';
import { contextColor, UNCATEGORIZED_COLOR } from '@/lib/palette';
import type { AppTotal } from '@/lib/summary';
import { cn } from '@/lib/utils';

interface Props {
  apps: AppTotal[];
}

/**
 * A bar list rather than a chart: the labels are long, arbitrary strings and
 * the interesting comparison is each app against the biggest one. Sub-bars sit
 * on the SAME scale as their app bar, so a context's share of its app is
 * readable as a length, not a percentage anyone has to compute.
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

  return (
    <Card>
      <CardHeader>
        <CardTitle>Top apps</CardTitle>
        <CardDescription>
          Expand an app to see its contexts — the site, project, or file it was spent in.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-1">
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
      max={max}
      // An app is not a category, so its bar carries no identity — one neutral
      // for all of them. A hue here would read as a category it doesn't have.
      color={UNCATEGORIZED_COLOR}
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
        {app.contexts.map((context, rank) => (
          <Bar
            key={context.name}
            name={context.name}
            seconds={context.seconds}
            max={max}
            // Ranked contexts read light→dark by size; the remainder is not a
            // rank, so it stays neutral.
            color={context.remainder ? UNCATEGORIZED_COLOR : contextColor(rank)}
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
  max: number;
  color: string;
  icon?: ReactNode;
  small?: boolean;
}

function Bar({ name, seconds, max, color, icon, small = false }: BarProps) {
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
        <div
          className="h-full rounded-r-[4px]"
          style={{
            width: `${Math.max(1, (seconds / max) * 100)}%`,
            background: color,
          }}
        />
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
