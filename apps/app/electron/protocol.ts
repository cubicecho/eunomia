import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, sep } from 'node:path';
import { Readable } from 'node:stream';
import { app, protocol } from 'electron';

// Serves the agent UI — the Expo web export — to the renderer.
//
// Not file://, for two reasons. Metro emits absolute asset paths (/_expo/…),
// which resolve to the filesystem root under file://; and a file:// page has
// an opaque origin, so localStorage and fetch behave nothing like they do on
// Android. A custom scheme registered as standard and secure gets a real
// origin, a working SPA fallback, and no server listening on a port.

const SCHEME = 'app';

/**
 * Where the renderer lives — the Expo web export. Matches `export:web` in
 * package.json. Packaged, the app path is the asar root and the export sits
 * beside dist/; in development it is this directory (electron/package.json is
 * what `electron ./electron` loads), so the export is one level up.
 */
const distDir = (): string =>
  app.isPackaged ? join(app.getAppPath(), 'dist-web') : join(app.getAppPath(), '..', 'dist-web');

const MIME: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json',
};

/**
 * Must run before `app.whenReady()` — chromium reads the scheme registry
 * during startup and ignores anything registered after it.
 */
export function registerAgentScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
    },
  ]);
}

/** The URL the agent window loads. */
export const AGENT_URL = `${SCHEME}://agent/`;

export function serveAgentBundle(): void {
  const root = distDir();

  protocol.handle(SCHEME, (request) => {
    const url = new URL(request.url);
    const file = resolveWithin(root, decodeURIComponent(url.pathname));
    // SPA fallback: `output: "single"` means one index.html answers every
    // route, and a missing asset should look like a 404 rather than the page.
    const target =
      file && existsSync(file) && statSync(file).isFile() ? file : join(root, 'index.html');

    if (!existsSync(target)) {
      return new Response('agent UI not built — run `npm run export:web -w @eunomia/app`', {
        status: 404,
        headers: { 'content-type': 'text/plain' },
      });
    }
    const body = Readable.toWeb(createReadStream(target)) as ReadableStream<Uint8Array>;
    return new Response(body, {
      headers: {
        'content-type': MIME[extname(target).toLowerCase()] ?? 'application/octet-stream',
      },
    });
  });
}

/**
 * Resolves a request path inside the bundle, or null if it escapes it. The
 * renderer is our own code, but a traversal here would hand the whole
 * filesystem to any script that reaches the page.
 */
function resolveWithin(root: string, pathname: string): string | null {
  const candidate = normalize(join(root, pathname));
  return candidate === root || candidate.startsWith(root + sep) ? candidate : null;
}
