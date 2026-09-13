import type { PingLogStore } from './outbox.ts';

// A PingLogStore held in memory — for tests, which need to reach into the
// "files" to tear a line or corrupt a cursor the way a crash would.

export interface MemoryLogStore extends PingLogStore {
  files: Map<string, string>;
  cursor: string | null;
  legacy: string | null;
  /** Complete lines across every day file. */
  lines(): number;
}

export function memoryLogStore(
  init: { files?: Record<string, string>; cursor?: string | null; legacy?: string | null } = {},
): MemoryLogStore {
  return {
    files: new Map(Object.entries(init.files ?? {})),
    cursor: init.cursor ?? null,
    legacy: init.legacy ?? null,
    days() {
      return [...this.files.keys()];
    },
    read(day) {
      return this.files.get(day) ?? null;
    },
    append(day, data) {
      this.files.set(day, (this.files.get(day) ?? '') + data);
    },
    remove(day) {
      this.files.delete(day);
    },
    readCursor() {
      return this.cursor;
    },
    writeCursor(data) {
      this.cursor = data;
    },
    readLegacyOutbox() {
      return this.legacy;
    },
    removeLegacyOutbox() {
      this.legacy = null;
    },
    lines() {
      return [...this.files.values()].reduce((n, text) => n + text.split('\n').length - 1, 0);
    },
  };
}
