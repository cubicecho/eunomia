import type { DeviceSummaryRow } from '@/api';
import { formatSeconds } from '@/lib/format';
import { sumSeconds } from '@/lib/summary';
import { cn } from '@/lib/utils';

interface Props {
  /** Per-device totals for the current range, busiest first. */
  devices: DeviceSummaryRow[];
  /** null = every device folded together. */
  selected: string | null;
  onChange(deviceId: string | null): void;
}

/**
 * The split and the filter in one control: each device's share of the range is
 * on its own tab, and picking one narrows every chart below to it. Two jobs,
 * because they're the same question — "how much of this was the laptop?" is
 * answered by the number on the tab, and followed up by clicking it.
 */
export function DevicePicker({ devices, selected, onChange }: Props) {
  // A selected device that recorded nothing in this range has no row, and
  // dropping its tab would strand the view filtered with no way back. Show it
  // at zero instead — that's also the honest answer to why the charts are empty.
  const rows =
    selected && !devices.some((device) => device.deviceId === selected)
      ? [...devices, { deviceId: selected, name: 'This device', platform: '', seconds: 0 }]
      : devices;

  // One device is not a split. Still render while filtered to it, though.
  if (rows.length < 2 && selected === null) return null;

  return (
    <div className="bg-muted/50 flex flex-wrap rounded-lg p-1" role="group" aria-label="Device">
      <Tab
        label="All devices"
        seconds={sumSeconds(devices)}
        active={selected === null}
        onClick={() => onChange(null)}
      />
      {rows.map((device) => (
        <Tab
          key={device.deviceId}
          label={device.name}
          title={device.platform ? `${device.name} (${device.platform})` : device.name}
          seconds={device.seconds}
          active={selected === device.deviceId}
          onClick={() => onChange(device.deviceId)}
        />
      ))}
    </div>
  );
}

interface TabProps {
  label: string;
  title?: string;
  seconds: number;
  active: boolean;
  onClick(): void;
}

function Tab({ label, title, seconds, active, onClick }: TabProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={active}
      className={cn(
        'flex items-baseline gap-2 rounded-md px-3 py-1 text-sm transition-colors',
        active
          ? 'bg-background text-foreground shadow-sm'
          : 'text-muted-foreground hover:text-foreground',
      )}
    >
      <span className="max-w-40 truncate">{label}</span>
      <span className="font-mono text-xs tabular-nums opacity-70">{formatSeconds(seconds)}</span>
    </button>
  );
}
