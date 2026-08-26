import { CircleAlert, Merge } from 'lucide-react';
import { useEffect, useState } from 'react';
import { type Device, deleteDevice, fetchDevices, mergeDevice, renameDevice } from '@/api';
import { ConfirmDelete } from '@/components/confirm-delete';
import { EmptyState } from '@/components/empty-state';
import { StatusLine } from '@/components/status-line';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useAction, useQuery } from '@/hooks/use-query';
import { ago } from '@/lib/format';

// The dead-agent tell: mobile background sync can lag 15+ minutes, so only
// longer silences get the warning treatment.
const STALE_AFTER_MS = 30 * 60 * 1000;

export function DevicesView() {
  const { data, error, reload } = useQuery(() => fetchDevices(), []);
  const action = useAction();

  if (error) return <p className="text-destructive text-sm">{error}</p>;
  if (!data) return null;
  const run = (mutation: () => Promise<unknown>) => action.run(mutation, { onDone: reload });

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Devices</CardTitle>
          <CardDescription>
            Every agent that has registered an API key with this server.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {data.length === 0 ? (
            <EmptyState>No devices yet — run an agent and register it.</EmptyState>
          ) : (
            data.map((device) => (
              <DeviceRow
                key={device.id}
                device={device}
                others={data.filter((other) => other.id !== device.id)}
                run={run}
              />
            ))
          )}
        </CardContent>
      </Card>
      <StatusLine status={action.status} />
    </div>
  );
}

interface RowProps {
  device: Device;
  /** The devices this one can be merged into. */
  others: Device[];
  run(mutation: () => Promise<unknown>): void;
}

function DeviceRow({ device, others, run }: RowProps) {
  const [name, setName] = useState(device.name);
  useEffect(() => setName(device.name), [device.name]);

  const trimmed = name.trim();
  const renamed = trimmed.length > 0 && trimmed !== device.name;
  const added = new Date(device.createdAt).toISOString().slice(0, 10);
  const seenMs = device.lastSeenAt ? Date.now() - new Date(device.lastSeenAt).getTime() : null;
  const stale = seenMs === null || seenMs > STALE_AFTER_MS;

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-dashed py-2 last:border-0">
      <Input
        className="w-56"
        aria-label={`Name of ${device.name}`}
        value={name}
        onChange={(event) => setName(event.target.value)}
      />
      <Button
        variant="outline"
        size="sm"
        disabled={!renamed}
        onClick={() => run(() => renameDevice(device.id, trimmed))}
      >
        Rename
      </Button>
      <span className="text-muted-foreground grow text-sm">
        {device.platform} · added {added}
      </span>
      <span
        className={
          stale
            ? 'text-destructive flex items-center gap-1 text-sm'
            : 'text-muted-foreground text-sm'
        }
      >
        {stale && <CircleAlert aria-hidden className="size-3.5" />}
        {seenMs === null ? 'never seen' : `seen ${ago(seenMs)}`}
      </span>
      <MergeDevice device={device} others={others} run={run} />
      <ConfirmDelete
        name={device.name}
        description="Its recorded activity is deleted with it and its API key stops working — the agent on that machine will have to be paired again. To keep the time it recorded, merge it into another device instead."
        onConfirm={() => run(() => deleteDevice(device.id))}
      >
        <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-destructive">
          Delete
        </Button>
      </ConfirmDelete>
    </div>
  );
}

/**
 * Folds one device into another — the fix for the same machine registered
 * twice, where deleting the duplicate would take its history with it. Merge the
 * stale duplicate into the device whose agent is still running: only the merged
 * device's key is revoked.
 */
function MergeDevice({ device, others, run }: RowProps) {
  const [open, setOpen] = useState(false);
  const [targetId, setTargetId] = useState('');
  const target = others.find((other) => other.id === targetId);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setTargetId('');
      }}
    >
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          disabled={others.length === 0}
          title={
            others.length === 0 ? 'Nothing to merge into yet' : `Merge ${device.name} into another`
          }
          className="text-muted-foreground hover:text-foreground"
        >
          <Merge className="size-4" />
          Merge
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Merge “{device.name}” into another device?</DialogTitle>
          <DialogDescription>
            Everything “{device.name}” recorded becomes the other device’s history, and “
            {device.name}” is removed. Its API key stops working, so merge the duplicate into the
            one whose agent is still running.
          </DialogDescription>
        </DialogHeader>
        <Select value={targetId} onValueChange={setTargetId}>
          <SelectTrigger className="w-full" aria-label="Merge into">
            <SelectValue placeholder="Merge into…" />
          </SelectTrigger>
          <SelectContent>
            {others.map((other) => (
              <SelectItem key={other.id} value={other.id}>
                {other.name} ({other.platform})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <Button
            disabled={!target}
            onClick={() => {
              if (!target) return;
              run(() => mergeDevice(device.id, target.id));
              setOpen(false);
            }}
          >
            Merge into “{target?.name ?? '…'}”
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
