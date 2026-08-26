import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { lexicographicSortSchema, printSchema } from 'graphql';
import type { AuthGateway } from '../src/auth.ts';
import { createDb } from '../src/db/client.ts';
import { createSchema } from '../src/graphql/schema.ts';

// Prints the public GraphQL schema as SDL to the repo root, where codegen
// turns it into the typed clients its consumers share — the agents
// (packages/agent) and the dashboard (apps/web). Committed on purpose: the
// SDL + generated types are the cross-package contract, so a server schema
// change surfaces as a typecheck/test failure in every consumer.
//
// Schema assembly never touches the database or auth — the db connects lazily
// and the gateway is only called by resolvers — so stubs are safe here.

const unreachable = (): Promise<never> =>
  Promise.reject(new Error('schema printing never calls auth'));
const stubAuth: AuthGateway = {
  mintDeviceKey: unreachable,
  sessionForDevice: unreachable,
  signUp: unreachable,
  signIn: unreachable,
  requestMagicLink: unreachable,
  verifyMagicLink: unreachable,
  signOut: unreachable,
};

const schema = createSchema(createDb('postgres://unused:unused@localhost:5432/unused'), stubAuth);
const outPath = fileURLToPath(new URL('../../../schema.graphql', import.meta.url));
writeFileSync(outPath, `${printSchema(lexicographicSortSchema(schema))}\n`);
console.log(`schema written to ${outPath}`);
