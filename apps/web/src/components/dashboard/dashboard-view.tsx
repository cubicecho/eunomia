import { useState } from 'react';
import { fetchAppSummary, fetchSummary } from '@/api';
import { CategoryChart } from '@/components/dashboard/category-chart';
import { DayChart } from '@/components/dashboard/day-chart';
import { RangePicker } from '@/components/dashboard/range-picker';
import { DashboardSkeleton } from '@/components/dashboard/skeleton';
import { StatTiles } from '@/components/dashboard/stat-tiles';
import { TopApps } from '@/components/dashboard/top-apps';
import { useQuery } from '@/hooks/use-query';
import { rangeOfLastDays } from '@/lib/format';
import { categoryTotals, dayRows, sumSeconds, topApps } from '@/lib/summary';

export function DashboardView() {
  const [range, setRange] = useState(() => rangeOfLastDays(7));
  const { data, error, loading } = useQuery(
    () => Promise.all([fetchSummary(range.from, range.to), fetchAppSummary(range.from, range.to)]),
    [range.from, range.to],
  );

  const [summary, appRows] = data ?? [[], []];
  const categories = categoryTotals(summary);
  const days = dayRows(summary, categories);
  const apps = topApps(appRows);
  const total = sumSeconds(categories);

  return (
    <div className="flex flex-col gap-6">
      <RangePicker range={range} onChange={setRange} />
      {error ? (
        <p className="text-destructive text-sm">{error}</p>
      ) : !data ? (
        <DashboardSkeleton />
      ) : (
        // The layout doesn't move while a range reloads — it dims, so the eye
        // keeps its place instead of re-finding it after every filter change.
        <div
          className={
            loading ? 'flex flex-col gap-6 opacity-60 transition-opacity' : 'flex flex-col gap-6'
          }
        >
          <StatTiles range={range} total={total} categories={categories} apps={apps} />
          <DayChart days={days} categories={categories} />
          {/* Stretched, not top-aligned: the category card is the shorter of
              the two, and a card that ends mid-row leaves a hole beside it. */}
          <div className="grid gap-6 lg:grid-cols-2">
            <CategoryChart categories={categories} />
            <TopApps apps={apps} />
          </div>
        </div>
      )}
    </div>
  );
}
