import { File, Paths } from 'expo-file-system';

// A released Android build has nowhere to print: logcat needs a cable and adb,
// and the background sync runs when nobody is watching at all. Tee everything
// the agent logs to a file next to its config and outbox, and let the app show
// it — the phone's answer to the desktop tray's "Show log file…".
//
// Truncates at a cap rather than rotating: this is a tail for "what happened
// just now", not an archive.

const MAX_BYTES = 128 * 1024;

/** Levels teed to the file — each keeps writing to the real console too. */
const LEVELS = ['log', 'info', 'warn', 'error'] as const;

const logFile = (): File => new File(Paths.document, 'agent.log');

export function logPath(): string {
  return logFile().uri;
}

export function readLog(): string {
  const file = logFile();
  return file.exists ? file.textSync() : '';
}

export function clearLog(): void {
  logFile().write('');
  written = 0;
}

/** Bytes in the file, tracked rather than stat'd on every line. */
let written = 0;
let started = false;

/**
 * Starts teeing console output to `<documents>/agent.log`. Idempotent: a
 * headless background launch and a foreground one both call it, and wrapping
 * the console twice would double every line.
 */
export function startFileLog(): void {
  if (started) return;
  started = true;

  const file = logFile();
  if (!file.exists) file.create();
  written = file.size;

  for (const level of LEVELS) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]): void => {
      original(...args);
      append(file, level.toUpperCase(), args);
    };
  }

  console.log('eunomia agent starting');
}

function append(file: File, level: string, args: unknown[]): void {
  const line = `${new Date().toISOString()} ${level} ${args.map(render).join(' ')}\n`;
  try {
    if (written + line.length > MAX_BYTES) {
      file.write(line);
      written = line.length;
      return;
    }
    file.write(line, { append: true });
    written += line.length;
  } catch {
    // A log that can't be written must never take the agent down — and must
    // never call console itself, which is wrapped by the time this runs.
  }
}

function render(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value instanceof Error) return value.stack ?? `${value.name}: ${value.message}`;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}
