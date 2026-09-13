import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import type { PingLogStore } from '@eunomia/agent';

// The desktop agent's ping log on disk: `<userData>/pings/<day>.jsonl`, with
// the upload cursor alongside so the directory is the whole record — copy it
// and you have everything, including how much of it the server has.

const SUFFIX = '.jsonl';

/** The directory, shown in the tray and the agent window. */
export const pingLogDir = (dataDir: string): string => join(dataDir, 'pings');

export function pingLogStore(dataDir: string): PingLogStore {
  const dir = pingLogDir(dataDir);
  const dayPath = (day: string): string => join(dir, `${day}${SUFFIX}`);
  const cursorPath = join(dir, 'cursor.json');
  const legacyPath = join(dataDir, 'outbox.jsonl');
  const readIfExists = (path: string): string | null =>
    existsSync(path) ? readFileSync(path, 'utf8') : null;

  return {
    days: () =>
      existsSync(dir)
        ? readdirSync(dir)
            .filter((name) => name.endsWith(SUFFIX))
            .map((name) => name.slice(0, -SUFFIX.length))
        : [],
    read: (day) => readIfExists(dayPath(day)),
    append: (day, data) => {
      mkdirSync(dir, { recursive: true });
      appendFileSync(dayPath(day), data);
    },
    remove: (day) => rmSync(dayPath(day), { force: true }),
    readCursor: () => readIfExists(cursorPath),
    // Temp file and rename: a crash mid-write leaves the old cursor whole
    // rather than a torn one that sends the log back to the start.
    writeCursor: (data) => {
      mkdirSync(dir, { recursive: true });
      const temp = `${cursorPath}.tmp`;
      writeFileSync(temp, data);
      renameSync(temp, cursorPath);
    },
    readLegacyOutbox: () => readIfExists(legacyPath),
    removeLegacyOutbox: () => rmSync(legacyPath, { force: true }),
  };
}
