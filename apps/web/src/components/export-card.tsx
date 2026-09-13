import { Download } from 'lucide-react';
import { useState } from 'react';
import { type ExportFormat, exportFile } from '@/api';
import { RangePicker } from '@/components/dashboard/range-picker';
import { StatusLine } from '@/components/status-line';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useAction } from '@/hooks/use-query';
import { addDays, type DateRange, dayIn, rangeOfLastDays } from '@/lib/format';
import { useTimeZone } from '@/session';

// Taking your data with you. The server hands a file over a chunk per request
// (Query.accountExport); this card follows the cursor and writes the chunks out
// as they come, so a years-long ping log never has to be one string in memory
// when the browser can stream to disk.

/** The File System Access picker — Chromium (and so the desktop app) only, and not in lib.dom. */
type SavePicker = (options: {
  suggestedName: string;
  types: { description: string; accept: Record<string, string[]> }[];
}) => Promise<FileSystemFileHandle>;

/** Where the chunks go: a file on disk, or a buffer that becomes a download. */
interface Sink {
  write(text: string): Promise<void>;
  close(): Promise<void>;
  abort(): Promise<void>;
}

interface FileSpec {
  name: string;
  type: string;
  extension: string;
  /** Gzipped on the way out — the bundle is mostly repeated keys and window titles. */
  gzip: boolean;
}

/** Straight to disk, through gzip when asked; nothing is committed unless it finishes. */
async function fileSink(handle: FileSystemFileHandle, gzip: boolean): Promise<Sink> {
  const file = await handle.createWritable();
  if (!gzip) {
    return {
      write: (text) => file.write(text),
      close: () => file.close(),
      abort: () => file.abort(),
    };
  }
  const compress = new CompressionStream('gzip');
  const piped = compress.readable.pipeTo(file);
  const writer = compress.writable.getWriter();
  const encoder = new TextEncoder();
  return {
    write: (text) => writer.write(encoder.encode(text)),
    close: async () => {
      await writer.close();
      await piped;
    },
    abort: async () => {
      await writer.abort().catch(() => {});
      await piped.catch(() => {});
    },
  };
}

/** Held in memory and handed to the browser as a download once complete. */
function downloadSink(spec: FileSpec): Sink {
  const parts: string[] = [];
  return {
    write: async (text) => {
      parts.push(text);
    },
    close: async () => {
      let blob = new Blob(parts, { type: spec.type });
      if (spec.gzip) {
        const gzipped = blob.stream().pipeThrough(new CompressionStream('gzip'));
        blob = await new Response(gzipped).blob();
      }
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = spec.name;
      anchor.click();
      // After the click has been dispatched, not before: revoking synchronously
      // can cancel the download in some browsers.
      setTimeout(() => URL.revokeObjectURL(url), 0);
    },
    abort: async () => {
      parts.length = 0;
    },
  };
}

/**
 * Asks where to save first — while the click still counts as a user gesture,
 * which the picker requires — or falls back to a download. Null when the user
 * dismissed the picker.
 */
async function openSink(spec: FileSpec): Promise<Sink | null> {
  const picker = (window as { showSaveFilePicker?: SavePicker }).showSaveFilePicker;
  if (!picker) return downloadSink(spec);
  try {
    const handle = await picker({
      suggestedName: spec.name,
      types: [{ description: spec.name, accept: { [spec.type]: [spec.extension] } }],
    });
    return await fileSink(handle, spec.gzip);
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') return null;
    // Refused for some other reason (a sandboxed frame, a policy): the
    // download still works.
    return downloadSink(spec);
  }
}

export function ExportCard() {
  const timeZone = useTimeZone();
  const action = useAction();
  const [range, setRange] = useState(() => rangeOfLastDays(30, timeZone));
  const [progress, setProgress] = useState<{ format: ExportFormat; rows: number } | null>(null);

  const start = async (format: ExportFormat, spec: FileSpec, ranged: DateRange | null) => {
    const sink = await openSink(spec);
    if (!sink) return;
    setProgress({ format, rows: 0 });
    action.run(
      async () => {
        try {
          let rows = 0;
          for await (const chunk of exportFile(format, ranged)) {
            await sink.write(chunk.data);
            rows += chunk.rows;
            setProgress({ format, rows });
          }
          await sink.close();
        } catch (cause) {
          await sink.abort();
          throw cause;
        } finally {
          setProgress(null);
        }
      },
      { success: `Exported ${spec.name}.` },
    );
  };

  // The range is shown inclusive, so the file is named for the last day in it.
  const rangeName = `${range.from}_${addDays(range.to, -1)}`;
  const exports: {
    format: ExportFormat;
    title: string;
    description: string;
    spec: FileSpec;
    ranged: boolean;
  }[] = [
    {
      format: 'BUNDLE',
      title: 'Everything',
      description:
        'Every device, category, rule, daily total, activity and raw ping, as gzipped JSON Lines. Never includes API keys or sessions.',
      spec: {
        name: `eunomia-export-${dayIn(new Date(), timeZone)}.jsonl.gz`,
        type: 'application/gzip',
        extension: '.gz',
        gzip: true,
      },
      ranged: false,
    },
    {
      format: 'ACTIVITYWATCH',
      title: 'ActivityWatch buckets',
      description:
        "The raw ping log in the range as a window and an AFK bucket per device, for ActivityWatch's Import page.",
      spec: {
        name: `eunomia-aw-buckets-${rangeName}.json`,
        type: 'application/json',
        extension: '.json',
        gzip: false,
      },
      ranged: true,
    },
    {
      format: 'SUMMARIES_CSV',
      title: 'Daily totals (CSV)',
      description: 'Seconds per day, device, category, app and context in the range.',
      spec: {
        name: `eunomia-summaries-${rangeName}.csv`,
        type: 'text/csv',
        extension: '.csv',
        gzip: false,
      },
      ranged: true,
    },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Export</CardTitle>
        <CardDescription>
          Your data as files you keep. Days are counted in{' '}
          <span className="text-foreground">{timeZone}</span>.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Range for ActivityWatch and CSV</span>
          <RangePicker range={range} timeZone={timeZone} onChange={setRange} />
        </div>
        <ul className="flex flex-col divide-y">
          {exports.map((item) => (
            <li
              key={item.format}
              className="flex flex-wrap items-center justify-between gap-2 py-3 first:pt-0 last:pb-0"
            >
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="text-sm font-medium">{item.title}</span>
                <span className="text-muted-foreground text-sm">{item.description}</span>
              </div>
              <div className="flex items-center gap-2">
                {progress?.format === item.format && (
                  <span className="text-muted-foreground text-sm tabular-nums">
                    {progress.rows.toLocaleString()} rows
                  </span>
                )}
                <Button
                  variant="outline"
                  disabled={action.pending}
                  onClick={() => start(item.format, item.spec, item.ranged ? range : null)}
                >
                  <Download className="size-4" />
                  {progress?.format === item.format ? 'Exporting…' : 'Download'}
                </Button>
              </div>
            </li>
          ))}
        </ul>
        <StatusLine status={action.status} />
      </CardContent>
    </Card>
  );
}
