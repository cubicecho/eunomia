// Cross-packaging helper: npm only installs the host platform's x-win
// prebuild, but the Windows package needs the win32 one. x-win's loader
// prefers a `x-win.win32-x64-msvc.node` sitting next to its index.js over the
// platform package, so download the prebuild tarball and drop the .node there.
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const xwinDir = dirname(require.resolve('@miniben90/x-win/package.json'));
const version = require('@miniben90/x-win/package.json').version;
const target = join(xwinDir, 'x-win.win32-x64-msvc.node');

if (existsSync(target)) {
  console.log(`win32 prebuild already present: ${target}`);
  process.exit(0);
}

const work = mkdtempSync(join(tmpdir(), 'xwin-win32-'));
try {
  const tarball = execFileSync(
    'npm',
    ['pack', `@miniben90/x-win-win32-x64-msvc@${version}`, '--pack-destination', work],
    { encoding: 'utf8' },
  )
    .trim()
    .split('\n')
    .pop();
  execFileSync('tar', ['xzf', join(work, tarball), '-C', work]);
  copyFileSync(join(work, 'package', 'x-win.win32-x64-msvc.node'), target);
  console.log(`win32 prebuild installed: ${target}`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
