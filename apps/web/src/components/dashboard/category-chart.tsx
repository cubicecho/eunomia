import { Bar, BarChart, CartesianGrid, Cell, LabelList, XAxis, YAxis } from 'recharts';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart';
import { formatSeconds } from '@/lib/format';
import type { Series } from '@/lib/summary';
import { EmptyState } from '@/components/empty-state';

const ROW_HEIGHT = 34;

/**
 * Magnitude by identity → one bar per category, sorted, horizontal so the
 * names read straight. Each category wears its own color (the one its owner
 * picked), so identity survives a range change that reorders the bars; the
 * name is on the axis, so color never carries the identity alone.
 */
export function CategoryChart({ categories }: { categories: Series[] }) {
  const config: ChartConfig = Object.fromEntries(
    categories.map((category) => [category.key, { label: category.name, color: category.color }]),
  );

  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle>By category</CardTitle>
        <CardDescription>Active time per category over the range.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col justify-center">
        {categories.length === 0 ? (
          <EmptyState>No activity in this range.</EmptyState>
        ) : (
          <ChartContainer
            config={config}
            className="aspect-auto w-full"
            style={{ height: categories.length * ROW_HEIGHT + 16 }}
          >
            <BarChart
              accessibilityLayer
              data={categories}
              layout="vertical"
              margin={{ left: 4, right: 64, top: 4, bottom: 4 }}
            >
              <CartesianGrid horizontal={false} strokeDasharray="2 4" />
              <YAxis
                type="category"
                dataKey="name"
                width={128}
                tickLine={false}
                axisLine={false}
                tickMargin={8}
              />
              <XAxis type="number" dataKey="seconds" hide />
              <ChartTooltip
                cursor={{ fill: 'var(--muted)', fillOpacity: 0.4 }}
                content={
                  <ChartTooltipContent
                    hideLabel
                    nameKey="name"
                    formatter={(value, name) => (
                      <span className="flex w-full justify-between gap-4">
                        <span className="text-muted-foreground">{name}</span>
                        <span className="font-medium">{formatSeconds(Number(value))}</span>
                      </span>
                    )}
                  />
                }
              />
              <Bar dataKey="seconds" barSize={18} radius={[0, 4, 4, 0]} isAnimationActive={false}>
                {categories.map((category) => (
                  <Cell key={category.key} fill={category.color} />
                ))}
                <LabelList
                  dataKey="seconds"
                  position="right"
                  offset={8}
                  className="fill-muted-foreground"
                  fontSize={12}
                  formatter={(value) => formatSeconds(Number(value))}
                />
              </Bar>
            </BarChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
}
