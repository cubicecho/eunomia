import { appendFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { format } from 'node:util';

// A packaged agent has nowhere to print: on Windows there is no console
// attached at all, so a revoked key, a crashed sampler, or a stalled upload
// leaves no trace anyone can look at. Tee everything the agent logs to a file
// next to its config and outbox, and let the tray open it.

const MAX_BYTES = 512 * 1024;

/** Levels teed to the file — each keeps writing to the real console too. */
const LEVELS = ['log', 'info', 'warn', 'error'] as const;

/**
 * Starts teeing console output to `<dataDir>/agent.log` and returns that path.
 * The file is truncated once it passes ~512 KB (single generation, no
 * rotation: this is a tail for "what happened just now", not an archive).
 */
export function startFileLog(dataDir: string): string {
  const path = join(dataDir, 'agent.log');
  let written = sizeOf(path);

  const write = (level: string, args: unknown[]): void => {
    const line = `${new Date().toISOString()} ${level} ${format(...args)}\n`;
    try {
      if (written + line.length > MAX_BYTES) {
        appendFileSync(path, '', { flag: 'w' });
        written = 0;
      }
      appendFileSync(path, line);
      written += line.length;
    } catch {
      // A log that can't be written must never take the agent down.
    }
  };

  for (const level of LEVELS) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]): void => {
      original(...args);
      write(level.toUpperCase(), args);
    };
  }

  // Otherwise a throw from a timer callback dies silently in a packaged build.
  process.on('uncaughtException', (error) => console.error('uncaught', error));
  process.on('unhandledRejection', (reason) => console.error('unhandled rejection', reason));

  console.log(`eunomia agent starting, logging to ${path}`);
  return path;
}

function sizeOf(path: string): number {
  try {
    return statSync(path).size;
  } catch {
    return 0;
  }
}
