import type { IncomingMessage, ServerResponse } from 'node:http';
import { createHttpHandler } from '@cubicecho/graphql-mcp';
import type { GraphQLSchema } from 'graphql';
import type { Context } from './graphql/context.ts';
import { VERSION } from './health.ts';

/**
 * The Model Context Protocol endpoint: the same GraphQL schema, projected as
 * tools an AI agent can discover and call.
 *
 * It runs against the *same* schema instance the /graphql endpoint serves, so
 * the CASL permissions applied during assembly cover it too — every tool call
 * executes in-process through the identical resolver chain, and the ownership
 * fences the reads carry (scope.ts) are the ones an agent gets. There is no
 * second authorization path here to keep in step, which is the whole point.
 *
 * Read-only on purpose. Mutations would become tools just as happily, but this
 * schema's mutations are the login flow, device registration and the ingestion
 * path — none of them things to hand an agent by default. Drop
 * `includeMutations: false` to expose them.
 */

/** Refuse bodies larger than this. MCP requests are small; anything else is not a client. */
const MAX_BODY_BYTES = 1024 * 1024;

/**
 * Reads and parses the JSON body. The MCP transport expects it already parsed
 * on `req.body` (Express's `express.json()` does this); this server is plain
 * node:http, so that is this function's job.
 */
async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new Error('request body too large');
    chunks.push(chunk as Buffer);
  }
  if (size === 0) return undefined;
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

/** node's header bag as a `Headers`, which is what the context factory reads. */
function toHeaders(req: IncomingMessage): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) for (const one of value) headers.append(name, one);
    else if (value !== undefined) headers.set(name, value);
  }
  return headers;
}

/**
 * Mounts the schema's queries as MCP tools over the Streamable HTTP transport.
 *
 * @param schema - The assembled, permissioned schema — the same instance /graphql serves.
 * @param contextFor - Resolves the caller from request headers (see createContextFactory).
 */
export function createMcpHandler(
  schema: GraphQLSchema,
  contextFor: (headers: Headers) => Promise<Context>,
) {
  const handler = createHttpHandler({
    schema,
    name: 'eunomia',
    version: VERSION,
    // Queries only — see the note above.
    includeMutations: false,
    // Identity comes from the same headers GraphQL reads, resolved by the same
    // function: `x-api-key` for a device key, `Authorization: Bearer` for a
    // session. An anonymous call reaches the permissions layer and is refused
    // there, exactly as it would over /graphql.
    contextFromRequest: (req) => contextFor(toHeaders(req)),
  });

  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    let body: unknown;
    try {
      body = await readJsonBody(req);
    } catch {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'invalid JSON body' }));
      return;
    }
    await handler(Object.assign(req, { body }), res);
  };
}
