import type { IncomingHttpHeaders } from 'node:http';
import { createHttpHandler, createServerFactory } from '@cubicecho/graphql-mcp';
import type { GraphQLSchema } from 'graphql';
import type { Context } from './graphql/context.ts';
import { VERSION } from './health.ts';
import { registerPrompts } from './mcp-prompts.ts';

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
 * Read-only by default. Mutations would become tools just as happily, but this
 * schema's mutations are the login flow, device registration and the ingestion
 * path — none of them things to hand an agent. The one exception is opt-in:
 * a key minted with the `categorize` scope also gets the categorization
 * mutations (CATEGORIZE_TOOLS), so an assistant can file time once its owner
 * has said it may.
 *
 * Prompts (mcp-prompts.ts) ride along on every server: standup, weekly review
 * and categorization triage, each filled in with the caller's own data.
 */

/** Refuse bodies larger than this. MCP requests are small; anything else is not a client. */
const MAX_BODY_BYTES = 1_000_000;

/** node's header bag as a `Headers`, which is what the context factory reads. */
function toHeaders(bag: IncomingHttpHeaders): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(bag)) {
    if (Array.isArray(value)) for (const one of value) headers.append(name, one);
    else if (value !== undefined) headers.set(name, value);
  }
  return headers;
}

/**
 * The categorization mutations an integration key with the `categorize` scope
 * gets as tools (issue #40). Everything else about writing — devices, keys,
 * deletion, ingestion, the login flow — stays off MCP for every caller.
 * `previewCategoryRule`, their dry run, is a query and so a tool for everyone.
 */
export const CATEGORIZE_TOOLS = [
  'createCategory',
  'createCategoryRule',
  'applyCategoryRules',
  'assignEntry',
  'assignActivity',
] as const;

/** Whether this caller gets the write tools: a key minted with the scope, nothing else. */
export function canCategorize(ctx: Context): boolean {
  return Boolean(ctx.userId && ctx.keyId && ctx.keyScopes?.includes('categorize'));
}

/**
 * Mounts the schema as MCP tools and prompts over the Streamable HTTP
 * transport, stateless: each request gets its own server.
 *
 * Which tools a request sees depends on who sent it, so the caller is resolved
 * first and the server built for them — the read tools for everyone, plus
 * CATEGORIZE_TOOLS for a key with that scope. A key without it never sees the
 * write tools listed, and calling one by name finds no such tool.
 *
 * @param schema - The assembled, permissioned schema — the same instance /graphql serves.
 * @param contextFor - Resolves the caller from request headers (see createContextFactory).
 */
export function createMcpHandler(
  schema: GraphQLSchema,
  contextFor: (headers: Headers) => Promise<Context>,
) {
  const common = {
    schema,
    name: 'eunomia',
    version: VERSION,
    // A file to download, not something to answer a question with: megabytes
    // of cursor-paged text that would only flood an agent's context. It is
    // session-only anyway, and agents authenticate with keys.
    // ssoSetup and setupCodePending are the sign-in page's plumbing: how this
    // server signs people in says nothing about anyone's time.
    // The language-model reads are the dashboard's: an assistant asking this
    // server to ask another model is a detour, and keys can't call them anyway.
    exclude: [
      'Query.accountExport',
      'Query.ssoSetup',
      'Query.setupCodePending',
      'Query.llmSettings',
      'Query.llmModels',
      'Query.suggestRules',
      'Query.draftStandup',
    ],
  };
  // Queries only — see the note at the top.
  const readOnly = createServerFactory({ ...common, includeMutations: false });
  const categorize = createServerFactory({
    ...common,
    includeMutations: true,
    include: ['Query.*', ...CATEGORIZE_TOOLS.map((field) => `Mutation.${field}`)],
  });

  // The handler reads the body under the cap, owns the per-request transport
  // and closes it with the server when the response ends; what is this
  // server's is who is calling and what they are offered.
  return createHttpHandler({
    schema,
    // Identity comes from the same headers GraphQL reads, resolved by the same
    // function: `x-api-key` for a key, `Authorization: Bearer` for a session.
    // An anonymous call reaches the permissions layer and is refused there,
    // exactly as it would over /graphql.
    contextFromRequest: (req) => contextFor(toHeaders(req.headers)),
    serverFor: (_req, context) => {
      const ctx = context as Context;
      const writes = canCategorize(ctx);
      const server = (writes ? categorize : readOnly)(() => ctx);
      registerPrompts(server, schema, ctx, writes);
      return server;
    },
    maxBodyBytes: MAX_BODY_BYTES,
  });
}
