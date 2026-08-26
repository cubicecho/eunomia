import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { addDays, type DateRange, rangeOfLastDays } from '@/lib/format';
import { cn } from '@/lib/utils';

// Whole labels rather than a "Last …" prefix: a range of one day is "Today",
// not "Last 1 day".
const PRESETS = [
  { label: 'Today', days: 1 },
  { label: 'Last 7 days', days: 7 },
  { label: 'Last 30 days', days: 30 },
  { label: 'Last 90 days', days: 90 },
] as const;

interface Props {
  range: DateRange;
  onChange(range: DateRange): void;
}

/**
 * A range is half-open [from, to) — but nobody reads "to 08/26" as "through
 * the 25th", so the inputs show the last day that's actually included and the
 * exclusive bound is put back on the way out.
 */
const shown = (range: DateRange): DateRange => ({ from: range.from, to: addDays(range.to, -1) });
const stored = (draft: DateRange): DateRange => ({ from: draft.from, to: addDays(draft.to, 1) });

/** Filters live in one row above the charts: presets first, custom behind them. */
export function RangePicker({ range, onChange }: Props) {
  const [draft, setDraft] = useState(() => shown(range));
  useEffect(() => setDraft(shown(range)), [range]);

  const dirty = draft.from !== range.from || stored(draft).to !== range.to;
  const ordered = draft.from <= draft.to;
  const activePreset = PRESETS.find((preset) => {
    const candidate = rangeOfLastDays(preset.days);
    return candidate.from === range.from && candidate.to === range.to;
  });

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="bg-muted/50 flex rounded-lg p-1">
        {PRESETS.map((preset) => (
          <button
            key={preset.days}
            type="button"
            onClick={() => onChange(rangeOfLastDays(preset.days))}
            className={cn(
              'rounded-md px-3 py-1 text-sm transition-colors',
              activePreset?.days === preset.days
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {preset.label}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="date"
          aria-label="From"
          className="w-auto"
          value={draft.from}
          onChange={(event) => setDraft({ ...draft, from: event.target.value })}
        />
        <span className="text-muted-foreground text-sm">→</span>
        <Input
          type="date"
          aria-label="To"
          className="w-auto"
          aria-invalid={!ordered}
          value={draft.to}
          onChange={(event) => setDraft({ ...draft, to: event.target.value })}
        />
        <Button
          variant="outline"
          size="sm"
          disabled={!dirty || !draft.from || !draft.to || !ordered}
          onClick={() => onChange(stored(draft))}
        >
          Apply
        </Button>
      </div>
    </div>
  );
}
