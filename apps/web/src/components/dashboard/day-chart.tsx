import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import { EmptyState } from '@/components/empty-state';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  type ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart';
import { formatSeconds, shortDay } from '@/lib/format';
import type { DayRow, Series } from '@/lib/summary';

interface Props {
  days: DayRow[];
  categories: Series[];
}

const HOUR = 3600;
const STEPS = [1, 2, 3, 4, 6, 8, 12, 24];

/**
 * Ticks on whole hours. Recharts' own ticks land on arbitrary second values,
 * and an "8h" label on a 7h51m gridline is just a rounding artifact the reader
 * has to squint past — so the ticks move to the labels, not the other way.
 */
function hourTicks(maxSeconds: number): number[] {
  const hours = Math.max(1, Math.ceil(maxSeconds / HOUR));
  const step = STEPS.find((candidate) => hours / candidate <= 5) ?? Math.ceil(hours / 5);
  const top = Math.ceil(hours / step) * step;
  const ticks: number[] = [];
  for (let hour = 0; hour <= top; hour += step) ticks.push(hour * HOUR);
  return ticks;
}

/**
 * Change over time, split by category: one stacked column per day. Stacked
 * rather than grouped because the day's total is the thing people read first
 * and the split is the follow-up question. Segments carry a 1px surface stroke
 * so touching fills stay separable, and the legend is always present.
 */
export function DayChart({ days, categories }: Props) {
  const config: ChartConfig = Object.fromEntries(
    categories.map((category) => [category.key, { label: category.name, color: category.color }]),
  );
  const ticks = hourTicks(Math.max(0, ...days.map((day) => day.total)));

  return (
    <Card>
      <CardHeader>
        <CardTitle>By day</CardTitle>
        <CardDescription>Active time per day, stacked by category.</CardDescription>
      </CardHeader>
      <CardContent>
        {days.length === 0 ? (
          <EmptyState>No activity in this range.</EmptyState>
        ) : (
          <ChartContainer config={config} className="aspect-auto h-[280px] w-full">
            <BarChart accessibilityLayer data={days} margin={{ left: 4, right: 4, top: 8 }}>
              <CartesianGrid vertical={false} strokeDasharray="2 4" />
              <XAxis
                dataKey="day"
                tickFormatter={shortDay}
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                minTickGap={16}
              />
              <YAxis
                width={40}
                tickLine={false}
                axisLine={false}
                tickMargin={4}
                ticks={ticks}
                domain={[0, ticks[ticks.length - 1] ?? HOUR]}
                tickFormatter={(seconds: number) => `${seconds / HOUR}h`}
              />
              <ChartTooltip
                cursor={{ fill: 'var(--muted)', fillOpacity: 0.4 }}
                content={
                  <ChartTooltipContent
                    labelFormatter={(label) => shortDay(String(label))}
                    formatter={(value, name) => (
                      <span className="flex w-full justify-between gap-4">
                        <span className="text-muted-foreground">
                          {config[String(name)]?.label ?? name}
                        </span>
                        <span className="font-medium">{formatSeconds(Number(value))}</span>
                      </span>
                    )}
                  />
                }
              />
              {categories.map((category, index) => (
                <Bar
                  key={category.key}
                  dataKey={category.key}
                  isAnimationActive={false}
                  maxBarSize={44}
                  stackId="day"
                  fill={category.color}
                  stroke="var(--card)"
                  strokeWidth={1}
                  // Only the top of the stack gets the rounded data-end.
                  radius={index === categories.length - 1 ? [4, 4, 0, 0] : 0}
                />
              ))}
              <ChartLegend content={<ChartLegendContent />} />
            </BarChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
}
