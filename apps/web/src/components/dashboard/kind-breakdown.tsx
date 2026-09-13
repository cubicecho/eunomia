import { EmptyState } from '@/components/empty-state';
import { Swatch } from '@/components/rules/swatch';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { formatSeconds } from '@/lib/format';
import type { KindTotal } from '@/lib/kinds';

interface Props {
  kinds: KindTotal[];
}

/**
 * Time by kind over the selected range: one stacked bar for the proportions,
 * then a labelled row per kind, so the colors are never the only way to tell
 * focus from distracting.
 */
export function KindBreakdown({ kinds }: Props) {
  const total = kinds.reduce((sum, kind) => sum + kind.seconds, 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Time by kind</CardTitle>
        <CardDescription>
          Each category’s kind — set on the Rules tab — adds up here. Uncategorized time has no kind
          and stays apart.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {total === 0 ? (
          <EmptyState>No activity in this range.</EmptyState>
        ) : (
          <>
            <div className="flex h-3.5 gap-[2px] overflow-hidden rounded-sm">
              {kinds.map((kind) => (
                <div
                  key={kind.key}
                  title={`${kind.label} — ${formatSeconds(kind.seconds)}`}
                  style={{ flex: `${kind.seconds} 0 0`, background: kind.color }}
                />
              ))}
            </div>
            <ul className="flex flex-col gap-1">
              {kinds.map((kind) => (
                <li key={kind.key} className="flex items-center gap-2 text-sm">
                  <Swatch color={kind.color} />
                  <span className="grow">{kind.label}</span>
                  <span className="text-muted-foreground w-10 text-right text-xs tabular-nums">
                    {Math.round((kind.seconds / total) * 100)}%
                  </span>
                  <span className="w-16 text-right font-mono text-xs tabular-nums">
                    {formatSeconds(kind.seconds)}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </CardContent>
    </Card>
  );
}
