import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// npm runs this after every install, which is the point: the generated SDKs are
// not in git, so a fresh clone, a CI runner, the EAS build machine and the
// Docker image all have to produce them before anything can compile. Install is
// the one step every one of those does.
//
// The exception is an image that installs dependencies before it copies source
// — the server's Dockerfile does, to keep the dependency layer cacheable. There
// the inputs genuinely aren't there yet and skipping is correct; that build runs
// codegen explicitly once the sources land. Anything else missing an input is a
// broken checkout, and the error it would raise is better than silence, so the
// skip is reported rather than swallowed.

const inputs = {
  schema: '../../../schema.graphql',
  'agent operations': '../../agent/src/operations.graphql',
  'web operations': '../../../apps/web/src/operations.graphql',
};

const missing = Object.entries(inputs)
  .filter(([, path]) => !existsSync(fileURLToPath(new URL(path, import.meta.url))))
  .map(([name]) => name);

if (missing.length > 0) {
  console.log(`@eunomia/gql: skipping codegen, no ${missing.join(', ')} yet`);
  process.exit(0);
}

execFileSync('npm', ['run', 'codegen'], {
  cwd: fileURLToPath(new URL('..', import.meta.url)),
  stdio: 'inherit',
});
