import { ChevronLeft, ChevronRight, ListPlus, Tag, Trash2, X } from 'lucide-react';
import { type PointerEvent, useMemo, useRef, useState } from 'react';
import {
  applyCategoryRules,
  assignActivity,
  type Category,
  createCategoryRule,
  type Device,
  deleteRange,
  fetchCategories,
  fetchDevices,
  fetchFocusSegments,
} from '@/api';
import { CardLayout } from '@/components/card-layout';
import { Combobox } from '@/components/combobox';
import { ConfirmButton } from '@/components/confirm-button';
import { EmptyState } from '@/components/empty-state';
import { FormField } from '@/components/form-field';
import { QueryError } from '@/components/query-state';
import { StatusLine } from '@/components/status-line';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { useAction, useQuery } from '@/hooks/use-query';
import { addDays, dayIn, formatSeconds } from '@/lib/format';
import { categoryColor } from '@/lib/palette';
import {
  activitiesIn,
  clip,
  dayBounds,
  lanes,
  ruleFor,
  type Selection,
  type SelectionEntry,
  snap,
  summarize,
  type TimelineSegment,
  ticks,
  viewWindow,
  ZOOMS,
} from '@/lib/timeline';
import { cn } from '@/lib/utils';
import { useTimeZone } from '@/session';

// The day, hour by hour: one lane per device, each focus a block coloured by
// its category (from focus segments, so the order things happened in is
// there, not just the totals). Drag across a lane to select a stretch, then
// categorize it, write a rule from it, or delete it.

const MINUTE = 60_000;

/** A drag shorter than this is a click, not a selection. */
const MIN_SELECTION_MS = MINUTE;

export function TimelineView() {
  const timeZone = useTimeZone();
  const [day, setDay] = useState(() => dayIn(new Date(), timeZone));
  const [zoom, setZoom] = useState<number>(24);
  const [centre, setCentre] = useState<number | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const action = useAction();

  const bounds = useMemo(() => dayBounds(day, timeZone), [day, timeZone]);
  const segments = useQuery(
    () => fetchFocusSegments(new Date(bounds.start), new Date(bounds.end)),
    [bounds.start, bounds.end],
  );
  const devices = useQuery(() => fetchDevices(), []);
  const categories = useQuery(() => fetchCategories(), []);

  const view = viewWindow(bounds, zoom, centre ?? (bounds.start + bounds.end) / 2);
  const all = segments.data ?? [];
  const visible = clip(all, view.from, view.to);
  const byDevice = lanes(visible);
  // Devices with something to show, then the rest, so an empty phone doesn't
  // push the laptop's lane down.
  const shown = (devices.data ?? []).filter((device) => byDevice.has(device.id));

  const goTo = (next: string) => {
    setDay(next);
    setCentre(null);
    setSelection(null);
  };
  const pan = (direction: -1 | 1) =>
    setCentre((view.from + view.to) / 2 + (direction * (view.to - view.from)) / 2);

  const refresh = () => {
    segments.reload();
    setSelection(null);
  };

  return (
    <div className="flex flex-col gap-4">
      <CardLayout
        title="Timeline"
        description={
          <>
            What was in front of you, in order, on each device. Drag across a lane to select a
            stretch of time and act on it.
          </>
        }
        contentClassName="gap-4"
        contentSlot={
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                size="icon"
                aria-label="Previous day"
                onClick={() => goTo(addDays(day, -1))}
                iconSlot={<ChevronLeft />}
              />
              <Input
                type="date"
                aria-label="Day"
                className="w-40"
                value={day}
                onChange={(event) => event.target.value && goTo(event.target.value)}
              />
              <Button
                variant="outline"
                size="icon"
                aria-label="Next day"
                onClick={() => goTo(addDays(day, 1))}
                iconSlot={<ChevronRight />}
              />
              <Button
                variant="outline"
                onClick={() => goTo(dayIn(new Date(), timeZone))}
                content="Today"
              />
              <div className="ml-auto flex items-center gap-1" role="group" aria-label="Zoom">
                {ZOOMS.map((level) => (
                  <Button
                    key={level.label}
                    size="sm"
                    variant={zoom === level.hours ? 'default' : 'outline'}
                    onClick={() => {
                      setZoom(level.hours);
                      // Zoom in on what's selected, when something is.
                      if (selection) setCentre((selection.from + selection.to) / 2);
                    }}
                    content={level.label}
                  />
                ))}
                {zoom < 24 ? (
                  <>
                    <Button
                      variant="outline"
                      size="icon"
                      aria-label="Earlier"
                      disabled={view.from <= bounds.start}
                      onClick={() => pan(-1)}
                      iconSlot={<ChevronLeft />}
                    />
                    <Button
                      variant="outline"
                      size="icon"
                      aria-label="Later"
                      disabled={view.to >= bounds.end}
                      onClick={() => pan(1)}
                      iconSlot={<ChevronRight />}
                    />
                  </>
                ) : null}
              </div>
            </div>

            {segments.error && !segments.data ? (
              <QueryError
                compact
                error={segments.error}
                onRetry={segments.refetch}
                what="this day's timeline"
              />
            ) : !segments.data ? (
              <div className="bg-muted h-24 animate-pulse rounded-md" />
            ) : shown.length === 0 ? (
              <EmptyState compact title={`Nothing recorded on ${day}.`} />
            ) : (
              <div className={cn('flex flex-col gap-2', segments.loading && 'opacity-60')}>
                <Axis from={view.from} to={view.to} origin={bounds.start} timeZone={timeZone} />
                {shown.map((device) => (
                  <Lane
                    key={device.id}
                    device={device}
                    segments={byDevice.get(device.id) ?? []}
                    from={view.from}
                    to={view.to}
                    timeZone={timeZone}
                    selection={
                      selection && (selection.deviceId ?? device.id) === device.id
                        ? selection
                        : null
                    }
                    onSelect={setSelection}
                  />
                ))}
              </div>
            )}
          </>
        }
      />

      {selection ? (
        <SelectionCard
          selection={selection}
          segments={all}
          devices={devices.data ?? []}
          categories={categories.data ?? []}
          timeZone={timeZone}
          onChange={setSelection}
          run={(mutation) => action.run(mutation, { onDone: refresh })}
        />
      ) : null}
      <StatusLine status={action.status} />
    </div>
  );
}

/** HH:MM in the user's zone. */
const clock = (at: number, timeZone: string): string =>
  new Intl.DateTimeFormat(undefined, {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(at));

/** Where `at` sits across the window, in percent. */
const percent = (at: number, from: number, to: number): number => ((at - from) / (to - from)) * 100;

function Axis(props: { from: number; to: number; origin: number; timeZone: string }) {
  const { from, to, origin, timeZone } = props;
  return (
    <div className="flex items-end gap-2">
      <div className="w-28 shrink-0" />
      <div className="text-muted-foreground relative h-5 grow text-xs">
        {ticks(from, to, origin).map((at) => (
          <span
            key={at}
            className="absolute -translate-x-1/2 tabular-nums"
            style={{ left: `${percent(at, from, to)}%` }}
          >
            {clock(at, timeZone)}
          </span>
        ))}
      </div>
    </div>
  );
}

interface LaneProps {
  device: Device;
  segments: TimelineSegment[];
  from: number;
  to: number;
  timeZone: string;
  selection: Selection | null;
  onSelect(selection: Selection | null): void;
}

function Lane({ device, segments, from, to, timeZone, selection, onSelect }: LaneProps) {
  const track = useRef<HTMLDivElement>(null);
  const anchor = useRef<number | null>(null);

  /** The instant under the pointer, snapped to a minute and kept inside the window. */
  const instantAt = (event: PointerEvent): number => {
    const rect = track.current!.getBoundingClientRect();
    const ratio = Math.min(Math.max((event.clientX - rect.left) / rect.width, 0), 1);
    return snap(from + ratio * (to - from), MINUTE);
  };

  const down = (event: PointerEvent) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    anchor.current = instantAt(event);
  };
  const move = (event: PointerEvent) => {
    if (anchor.current === null) return;
    const at = instantAt(event);
    if (Math.abs(at - anchor.current) < MIN_SELECTION_MS) return;
    onSelect({
      deviceId: device.id,
      from: Math.min(anchor.current, at),
      to: Math.max(anchor.current, at),
    });
  };
  const up = () => {
    anchor.current = null;
  };

  return (
    <div className="flex items-center gap-2">
      <div className="w-28 shrink-0 truncate text-sm" title={device.name}>
        {device.name}
      </div>
      <div
        ref={track}
        role="presentation"
        className="bg-muted relative h-10 grow cursor-crosshair touch-none overflow-hidden rounded-md select-none"
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
      >
        {segments.map((segment) => (
          <div
            key={segment.id}
            className="absolute inset-y-1 min-w-px rounded-[2px]"
            style={{
              left: `${percent(segment.start, from, to)}%`,
              width: `${percent(segment.end, from, to) - percent(segment.start, from, to)}%`,
              background: categoryColor(segment.categoryId, segment.color),
            }}
            title={describe(segment, timeZone)}
          />
        ))}
        {selection ? (
          <div
            className="border-primary bg-primary/30 pointer-events-none absolute inset-y-0 border-x-2"
            style={{
              left: `${percent(Math.max(selection.from, from), from, to)}%`,
              width: `${percent(Math.min(selection.to, to), from, to) - percent(Math.max(selection.from, from), from, to)}%`,
            }}
          />
        ) : null}
      </div>
    </div>
  );
}

/** A segment's tooltip: when, what, and where it was filed. */
function describe(segment: TimelineSegment, timeZone: string): string {
  const what = [segment.app, segment.context].filter(Boolean).join(' · ');
  const span = `${clock(segment.start, timeZone)}–${clock(segment.end, timeZone)}`;
  const title = segment.title ? `\n${segment.title}` : '';
  return `${span}  ${what}${title}\n${segment.categoryName ?? 'Uncategorized'}`;
}

interface SelectionProps {
  selection: Selection;
  segments: TimelineSegment[];
  devices: Device[];
  categories: Category[];
  timeZone: string;
  onChange(selection: Selection | null): void;
  run(mutation: () => Promise<unknown>): void;
}

function SelectionCard(props: SelectionProps) {
  const { selection, segments, devices, categories, timeZone, onChange, run } = props;
  const [categoryId, setCategoryId] = useState<string>('');
  const entries = summarize(segments, selection);
  const activityIds = activitiesIn(segments, selection);
  const total = entries.reduce((sum, entry) => sum + entry.seconds, 0);
  const where =
    selection.deviceId === null
      ? 'every device'
      : (devices.find((device) => device.id === selection.deviceId)?.name ?? 'this device');
  const span = `${clock(selection.from, timeZone)}–${clock(selection.to, timeZone)}`;

  const categorize = () =>
    run(async () => {
      for (const id of activityIds) await assignActivity(id, categoryId);
    });

  return (
    <CardLayout
      title={`${span} on ${where}`}
      description={`${formatSeconds(total)} of activity across ${entries.length} ${entries.length === 1 ? 'entry' : 'entries'}.`}
      actionSlot={
        <Button
          variant="outline"
          size="icon-sm"
          aria-label="Clear selection"
          onClick={() => onChange(null)}
          iconSlot={<X />}
        />
      }
      contentClassName="gap-4"
      contentSlot={
        <>
          {selection.deviceId !== null && devices.length > 1 ? (
            <FormField
              orientation="horizontal"
              label="The same time on every device"
              controlSlot={
                <Checkbox
                  checked={false}
                  onCheckedChange={() => onChange({ ...selection, deviceId: null })}
                />
              }
            />
          ) : null}

          {entries.length === 0 ? (
            <EmptyState compact title="Nothing was in front in this stretch." />
          ) : (
            <ul className="flex flex-col gap-1">
              {entries.map((entry) => (
                <EntryRow
                  key={`${entry.app}\n${entry.context ?? ''}\n${entry.categoryId ?? ''}`}
                  entry={entry}
                  categories={categories}
                  run={run}
                />
              ))}
            </ul>
          )}

          <p className="text-muted-foreground text-xs">
            Categorizing assigns each activity in the selection as a whole, including any part of it
            outside the selection, and rules won't move it again. To file an app from now on, make a
            rule from its row instead.
          </p>
        </>
      }
      footerSlot={
        <ConfirmButton
          variant="destructive-outline"
          iconSlot={<Trash2 />}
          content="Delete this stretch"
          title={`Delete ${span} on ${where}?`}
          description="Everything recorded in this stretch is deleted: pings, activities and the time in your charts. Pings from it still on their way from an agent are dropped when they arrive."
          onConfirm={() =>
            run(() =>
              deleteRange(new Date(selection.from), new Date(selection.to), selection.deviceId),
            )
          }
        />
      }
      footerActionsSlot={
        <>
          <Combobox
            className="w-48"
            aria-label="Category"
            placeholder="Category…"
            options={categories.map((category) => ({
              value: category.id,
              label: category.name,
              color: category.color ?? undefined,
            }))}
            value={categoryId}
            onValueChange={setCategoryId}
          />
          <Button
            disabled={!categoryId || activityIds.length === 0}
            onClick={categorize}
            iconSlot={<Tag />}
            content={`Categorize ${activityIds.length} ${activityIds.length === 1 ? 'activity' : 'activities'}`}
          />
        </>
      }
    />
  );
}

function EntryRow({
  entry,
  categories,
  run,
}: {
  entry: SelectionEntry;
  categories: Category[];
  run(mutation: () => Promise<unknown>): void;
}) {
  const [making, setMaking] = useState(false);
  const [categoryId, setCategoryId] = useState('');

  const makeRule = () =>
    run(async () => {
      await createCategoryRule({
        categoryId,
        ...ruleFor(entry),
        titlePattern: null,
        priority: null,
      });
      await applyCategoryRules();
      setMaking(false);
    });

  return (
    <li className="flex flex-wrap items-center gap-2 text-sm">
      <span
        className="size-3 shrink-0 rounded-sm"
        style={{ background: categoryColor(entry.categoryId, entry.color) }}
      />
      <span className="min-w-0 grow truncate">
        {entry.app}
        {entry.context ? <span className="text-muted-foreground"> · {entry.context}</span> : null}
      </span>
      <span className="text-muted-foreground">{entry.categoryName ?? 'Uncategorized'}</span>
      <span className="w-16 text-right tabular-nums">{formatSeconds(entry.seconds)}</span>
      {making ? (
        <>
          <Combobox
            className="w-40"
            aria-label={`Rule category for ${entry.app}`}
            placeholder="Category…"
            options={categories.map((category) => ({
              value: category.id,
              label: category.name,
              color: category.color ?? undefined,
            }))}
            value={categoryId}
            onValueChange={setCategoryId}
          />
          <Button size="sm" disabled={!categoryId} onClick={makeRule} content="Add rule" />
          <Button size="sm" variant="outline" onClick={() => setMaking(false)} content="Cancel" />
        </>
      ) : (
        <Button
          size="sm"
          variant="outline"
          onClick={() => setMaking(true)}
          iconSlot={<ListPlus />}
          content="Rule"
        />
      )}
    </li>
  );
}
