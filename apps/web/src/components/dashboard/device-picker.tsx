import type { DeviceSummaryRow } from '@/api';
import { SegmentedButton, SegmentedGroup } from '@/components/ui/segmented';
import { formatSeconds } from '@/lib/format';
import { sumSeconds } from '@/lib/summary';

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
    <SegmentedGroup
      aria-label="Device"
      className="h-auto flex-wrap"
      value={selected ?? ALL}
      onValueChange={(value) => onChange(value === ALL ? null : value)}
    >
      <SegmentedButton value={ALL}>
        <DeviceLabel label="All devices" seconds={sumSeconds(devices)} />
      </SegmentedButton>
      {rows.map((device) => (
        <SegmentedButton
          key={device.deviceId}
          value={device.deviceId}
          title={device.platform ? `${device.name} (${device.platform})` : device.name}
        >
          <DeviceLabel label={device.name} seconds={device.seconds} />
        </SegmentedButton>
      ))}
    </SegmentedGroup>
  );
}

/** Not a device id: the pill that folds every device together. */
const ALL = '__all__';

function DeviceLabel({ label, seconds }: { label: string; seconds: number }) {
  return (
    <span className="flex items-baseline gap-2 text-sm">
      <span className="max-w-40 truncate">{label}</span>
      <span className="font-mono text-xs tabular-nums opacity-70">{formatSeconds(seconds)}</span>
    </span>
  );
}
