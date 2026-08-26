import { Card, CardContent } from '@/components/ui/card';
import { type DateRange, daysInRange, formatSeconds } from '@/lib/format';
import type { AppTotal, Series } from '@/lib/summary';

interface Props {
  range: DateRange;
  total: number;
  categories: Series[];
  apps: AppTotal[];
}

/**
 * The four numbers worth reading before any chart. Plain figures, no
 * sparklines: a tile that has nothing to plot shouldn't pretend otherwise.
 */
export function StatTiles({ range, total, categories, apps }: Props) {
  const days = daysInRange(range);
  const [topCategory] = categories;
  const [topApp] = apps;

  const tiles = [
    {
      label: 'Tracked',
      value: formatSeconds(total),
      hint: days === 1 ? 'over one day' : `over ${days} days`,
    },
    {
      label: 'Daily average',
      value: formatSeconds(Math.round(total / days)),
      hint: 'across every day in range',
    },
    {
      label: 'Top category',
      value: topCategory?.name ?? '—',
      hint: topCategory ? formatSeconds(topCategory.seconds) : 'nothing categorized yet',
      color: topCategory?.color,
    },
    {
      label: 'Top app',
      value: topApp?.name ?? '—',
      hint: topApp ? formatSeconds(topApp.seconds) : 'no activity yet',
    },
  ];

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {tiles.map((tile) => (
        <Card key={tile.label} className="py-4">
          <CardContent className="px-4">
            <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
              {tile.label}
            </p>
            <p className="mt-1 flex items-center gap-2 truncate text-2xl font-semibold">
              {tile.color ? (
                <span
                  aria-hidden
                  className="size-2.5 shrink-0 rounded-[2px]"
                  style={{ background: tile.color }}
                />
              ) : null}
              <span className="truncate">{tile.value}</span>
            </p>
            <p className="text-muted-foreground mt-1 truncate text-xs">{tile.hint}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
