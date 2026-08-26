import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { cn } from '@/lib/utils';

const Block = ({ className }: { className?: string }) => (
  <div className={cn('bg-muted animate-pulse rounded-md', className)} />
);

/**
 * The first load has no data at all, and rendering the real components with
 * empty arrays says "no activity in this range" — an answer, and the wrong
 * one. This holds the layout instead until the numbers arrive.
 */
export function DashboardSkeleton() {
  return (
    <div
      className="flex flex-col gap-6"
      role="status"
      aria-busy="true"
      aria-label="Loading activity"
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((tile) => (
          <Card key={tile} className="py-4">
            <CardContent className="flex flex-col gap-2 px-4">
              <Block className="h-3 w-20" />
              <Block className="h-7 w-28" />
              <Block className="h-3 w-24" />
            </CardContent>
          </Card>
        ))}
      </div>
      <Card>
        <CardHeader>
          <Block className="h-4 w-24" />
        </CardHeader>
        <CardContent>
          <Block className="h-[280px] w-full" />
        </CardContent>
      </Card>
      <div className="grid items-start gap-6 lg:grid-cols-2">
        {[0, 1].map((card) => (
          <Card key={card}>
            <CardHeader>
              <Block className="h-4 w-28" />
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {[0, 1, 2, 3, 4].map((row) => (
                <Block key={row} className="h-4 w-full" />
              ))}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
