import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SegmentedButton, SegmentedGroup } from '@/components/ui/segmented';
import { addDays, type DateRange, rangeOfLastDays } from '@/lib/format';

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
  /** The user's zone: "today" is today there, and the presets end after it. */
  timeZone: string;
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
export function RangePicker({ range, timeZone, onChange }: Props) {
  const [draft, setDraft] = useState(() => shown(range));
  useEffect(() => setDraft(shown(range)), [range]);

  const dirty = draft.from !== range.from || stored(draft).to !== range.to;
  const ordered = draft.from <= draft.to;
  const activePreset = PRESETS.find((preset) => {
    const candidate = rangeOfLastDays(preset.days, timeZone);
    return candidate.from === range.from && candidate.to === range.to;
  });

  return (
    <div className="flex flex-wrap items-center gap-2">
      <SegmentedGroup
        aria-label="Range"
        value={activePreset ? String(activePreset.days) : undefined}
        onValueChange={(days) => onChange(rangeOfLastDays(Number(days), timeZone))}
      >
        {PRESETS.map((preset) => (
          <SegmentedButton key={preset.days} value={String(preset.days)}>
            {preset.label}
          </SegmentedButton>
        ))}
      </SegmentedGroup>
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
          content="Apply"
        />
      </div>
    </div>
  );
}
