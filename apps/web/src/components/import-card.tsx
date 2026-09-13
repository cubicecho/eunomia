import { Upload } from 'lucide-react';
import { useState } from 'react';
import { fetchDevices, fetchMe, type ImportSource, type ImportTarget, importChunk } from '@/api';
import { StatusLine } from '@/components/status-line';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useAction, useQuery } from '@/hooks/use-query';
import {
  type AwBucket,
  type AwHost,
  awHosts,
  awRecords,
  bundleRecords,
  csvImportRecords,
  type ImportProgress,
  type ImportRecord,
  type ImportResult,
  parseAwExport,
  readText,
  runImport,
  wholeText,
} from '@/lib/import';
import { useSession } from '@/session';

// Bringing history in: a restore of this app's own export, or another
// tracker's (lib/import.ts reads the file and drives the calls). Everything
// lands in the signed-in account; nothing here can name another.

const NEW_DEVICE = '__new';

const PLATFORMS = ['windows', 'macos', 'linux', 'android'] as const;

const SOURCES: {
  source: ImportSource;
  label: string;
  accept: string;
  description: string;
}[] = [
  {
    source: 'BUNDLE',
    label: 'Eunomia export (everything)',
    accept: '.gz,.jsonl,application/gzip',
    description:
      'Restores categories and rules (skipping ones you already have), your time zone if you haven’t set one, and each device as a new device with its history. Devices come back without keys: pair an agent with one, or merge it into the device you use now.',
  },
  {
    source: 'ACTIVITYWATCH',
    label: 'ActivityWatch',
    accept: '.json,.gz,application/json',
    description:
      'The export from ActivityWatch’s Settings page. One machine’s window, AFK and browser buckets become that device’s history, run through your rules like any recorded time. Importing into a device that already has later history rebuilds it; time older than a device’s pruned history is left out.',
  },
  {
    source: 'RESCUETIME',
    label: 'RescueTime',
    accept: '.csv,.json,text/csv,application/json',
    description:
      'RescueTime’s activity report (CSV or API JSON). It has totals per app, not moments, so it becomes daily totals on the device you pick — no timeline, focus or sessions for those days. Importing the same file twice counts it twice.',
  },
];

export function ImportCard() {
  const { me, setMe } = useSession();
  const action = useAction();
  const devices = useQuery(() => fetchDevices(), []);
  const [source, setSource] = useState<ImportSource>('BUNDLE');
  const [file, setFile] = useState<File | null>(null);
  const [hosts, setHosts] = useState<{ list: AwHost[]; buckets: AwBucket[] } | null>(null);
  const [hostname, setHostname] = useState<string | null>(null);
  const [deviceId, setDeviceId] = useState(NEW_DEVICE);
  const [newName, setNewName] = useState('');
  const [platform, setPlatform] = useState<(typeof PLATFORMS)[number]>('linux');
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);

  const spec = SOURCES.find((s) => s.source === source)!;
  const targeted = source !== 'BUNDLE';

  const choose = (next: File | null) => {
    setFile(next);
    setHosts(null);
    setHostname(null);
    setResult(null);
    if (next && source === 'ACTIVITYWATCH') {
      // One JSON document: read now, to offer its machines before importing.
      action.run(async () => {
        const buckets = parseAwExport(await wholeText(readText(next)));
        const list = awHosts(buckets);
        if (list.length === 0) throw new Error('This export has no window buckets to import');
        setHosts({ list, buckets });
        setHostname(list[0]!.hostname);
        setNewName((name) => name || list[0]!.hostname);
      });
    }
  };

  const target: ImportTarget | null = !targeted
    ? null
    : deviceId === NEW_DEVICE
      ? { newDeviceName: newName.trim(), platform }
      : { deviceId };
  const ready =
    file !== null &&
    (!targeted || deviceId !== NEW_DEVICE || newName.trim() !== '') &&
    (source !== 'ACTIVITYWATCH' || hostname !== null);

  const start = () => {
    if (!file || !ready) return;
    setResult(null);
    setProgress({ records: 0, pings: 0, pass: 1 });
    action.run(
      async () => {
        try {
          let records: (pass: number) => AsyncIterable<ImportRecord>;
          if (source === 'BUNDLE') records = (pass) => bundleRecords(file, pass);
          else if (source === 'RESCUETIME') records = () => csvImportRecords(file);
          else {
            const events = awRecords(hosts!.buckets, hostname!);
            records = () => iterate(events);
          }
          const done = await runImport(
            (variables) => importChunk(variables),
            source,
            target,
            records,
            setProgress,
          );
          setResult(done);
          // A restore may have set the time zone, and every import adds devices
          // or history the rest of the dashboard should see.
          if (source === 'BUNDLE') {
            const fresh = await fetchMe();
            if (fresh) setMe(fresh);
          }
          devices.reload();
        } finally {
          setProgress(null);
        }
      },
      { success: `Imported ${file.name}.` },
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Import</CardTitle>
        <CardDescription>
          History from a file, into this account. Days are counted in{' '}
          <span className="text-foreground">{me.effectiveTimeZone}</span>.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="import-source">From</Label>
            <Select
              value={source}
              onValueChange={(value) => {
                setSource(value as ImportSource);
                setFile(null);
                setHosts(null);
                setResult(null);
              }}
              disabled={action.pending}
            >
              <SelectTrigger id="import-source" className="w-64">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SOURCES.map((s) => (
                  <SelectItem key={s.source} value={s.source}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="import-file">File</Label>
            <Input
              // A new input per source, so switching clears the chosen file.
              key={source}
              id="import-file"
              type="file"
              className="w-72"
              accept={spec.accept}
              disabled={action.pending}
              onChange={(event) => choose(event.target.files?.[0] ?? null)}
            />
          </div>
        </div>
        <p className="text-muted-foreground text-sm">{spec.description}</p>

        {hosts && hosts.list.length > 1 && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="import-host">Machine</Label>
            <Select value={hostname ?? undefined} onValueChange={setHostname}>
              <SelectTrigger id="import-host" className="w-64">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {hosts.list.map((host) => (
                  <SelectItem key={host.hostname} value={host.hostname}>
                    {host.hostname} ({host.windowEvents.toLocaleString()} window events)
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        {hosts && hostname && !hosts.list.find((h) => h.hostname === hostname)?.afk && (
          <p className="text-muted-foreground text-sm">
            No AFK bucket for {hostname}: every window interval counts as time in front of it.
          </p>
        )}

        {targeted && (
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="import-device">Into</Label>
              <Select value={deviceId} onValueChange={setDeviceId} disabled={action.pending}>
                <SelectTrigger id="import-device" className="w-64">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NEW_DEVICE}>A new device</SelectItem>
                  {(devices.data ?? []).map((device) => (
                    <SelectItem key={device.id} value={device.id}>
                      {device.name} ({device.platform})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {deviceId === NEW_DEVICE && (
              <>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="import-device-name">Name</Label>
                  <Input
                    id="import-device-name"
                    className="w-48"
                    value={newName}
                    onChange={(event) => setNewName(event.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="import-platform">Platform</Label>
                  <Select
                    value={platform}
                    onValueChange={(value) => setPlatform(value as (typeof PLATFORMS)[number])}
                  >
                    <SelectTrigger id="import-platform" className="w-36">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PLATFORMS.map((p) => (
                        <SelectItem key={p} value={p}>
                          {p}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Button disabled={!ready || action.pending} onClick={start}>
            <Upload className="size-4" />
            {progress ? 'Importing…' : 'Import'}
          </Button>
          {progress && (
            <span className="text-muted-foreground text-sm tabular-nums">
              {progress.pass > 1 ? 'Second read: ' : ''}
              {progress.records.toLocaleString()} records
              {progress.pings > 0 && `, ${progress.pings.toLocaleString()} pings`}
            </span>
          )}
        </div>
        {result && (
          <div className="flex flex-col gap-1 text-sm">
            <p>
              {result.accepted.toLocaleString()} records imported
              {result.pings > 0 && ` as ${result.pings.toLocaleString()} pings`}
              {result.skipped > 0 && `, ${result.skipped.toLocaleString()} skipped`}.
            </p>
            {result.warnings.length > 0 && (
              <ul className="text-muted-foreground list-disc pl-5">
                {result.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            )}
          </div>
        )}
        <StatusLine status={action.status} />
      </CardContent>
    </Card>
  );
}

async function* iterate<T>(items: T[]): AsyncGenerator<T> {
  yield* items;
}
