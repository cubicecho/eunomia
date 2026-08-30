import { join } from 'node:path';
import { app } from 'electron';

/**
 * Where a preload script is loaded from. Both preloads are built by
 * `build:preload`, never run from source: agent-preload.cjs takes its method
 * list from src/host/bridge.ts, so it has to be bundled to exist at all.
 *
 * The two branches are the same directory reached from different roots.
 * `app.getAppPath()` is the app's package.json dir: apps/app in a packaged
 * build, but electron/ when running from source, because electron/package.json
 * is what makes `electron ./electron` work.
 */
export const preloadPath = (name: string): string =>
  join(app.getAppPath(), app.isPackaged ? 'dist' : '../dist', name);
