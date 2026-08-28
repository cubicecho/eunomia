import type { CodegenConfig } from '@graphql-codegen/cli';

// Every artifact graphql-codegen produces for this repo, generated in one pass
// into src/, which is gitignored: this is build output, regenerated from
// /schema.graphql on install and before every typecheck, test and build. What
// is committed is the input — the SDL — and this config.
//
// One package rather than three src/gql directories because three toolchains
// consume it (tsc, Vite, Metro/esbuild) and all of them already resolve
// workspace packages. Consumers import `@eunomia/gql/resolvers`,
// `@eunomia/gql/agent` and `@eunomia/gql/web`; nothing needs an alias.
//
// The schema is this server's own printed output — a fixpoint, not a spec.
// That is fine because the half it types is authored: the domain fields come
// from apps/server/src/graphql/domain.graphql, and codegen turns them into the
// argument and return types their resolvers are checked against. The generated
// half (drizzle-graphql) contributes the row types those resolvers hand back.

const schema = '../../schema.graphql';

// Both client SDKs are the same generator with a different document set. The
// only reason they are separate files is that each embeds its own operations.
//
// documentMode 'string': operations ship as plain strings, which keeps the
// `graphql` package out of both the browser bundle and the agents' runtime
// deps. enumsAsTypes and the erasable shim below are the desktop agent's
// constraint — electron runs it straight from TS source under Node's
// strip-only type stripping, which permits no enums and no runtime-typed
// constructs.
const clientSdk = (documents: string) => ({
  documents,
  plugins: [
    {
      // typescript-generic-sdk with documentMode 'string' emits
      // `new TypedDocumentString(...)` but leaves the definition to the
      // client-preset runtime, which we don't use — supply a minimal one.
      add: {
        content: [
          'class DocumentString extends String {}',
          '/**',
          ' * Runtime value is a String subclass; typed as `string` so the document',
          ' * constants below flow into the string-typed Requester.',
          ' */',
          'const TypedDocumentString = DocumentString as unknown as new (value: string) => string;',
          '',
        ].join('\n'),
      },
    },
    // No `typescript` plugin here, unlike the resolvers below: it emits the
    // whole schema — every filter and order-by drizzle-graphql generates —
    // none of which a client imports, and it re-declares the input types
    // typescript-operations already emits for operation variables (a duplicate
    // `PingInput`, which is a compile error). It would also collide on enums:
    // typescript-operations re-declares any enum an operation selects unless
    // the schema types come from another file, so selecting Devices.platform
    // would emit DevicesPlatformEnum twice.
    'typescript-operations',
    'typescript-generic-sdk',
  ],
  config: {
    documentMode: 'string',
    enumsAsTypes: true,
    scalars: { DateTime: 'string' },
  },
});

const config: CodegenConfig = {
  schema,
  generates: {
    // What types every hand-written resolver in apps/server/src/graphql, so a
    // schema change a resolver hasn't caught up with is a typecheck failure
    // rather than a runtime surprise.
    'src/resolvers.ts': {
      plugins: ['typescript', 'typescript-resolvers'],
      config: {
        // Reaching back into the server from a shared package is the one
        // coupling here, and it is inherent: these types describe that
        // server's resolvers. Paths are relative to the emitted file.
        contextType: '../../../apps/server/src/graphql/context.ts#Context',
        // Resolvers hand back Drizzle rows, not the GraphQL shape: the row is
        // what the database returned, and the field resolvers read columns off
        // it. Mapping each generated type to its row type is what makes
        // `return row` type-check — and what makes returning the wrong table's
        // row an error.
        mappers: {
          Activities: '../../../apps/server/src/activity/fold.ts#Activity',
          CategoryRules: '../../../apps/server/src/activity/rules.ts#CategoryRule',
          ContextRules: '../../../apps/server/src/activity/context.ts#ContextRule',
          MergeRules: '../../../apps/server/src/activity/merge-rules.ts#MergeRule',
          Categories: '../../../apps/server/src/db/schema.ts#Category',
          Devices: '../../../apps/server/src/db/schema.ts#Device',
          Summaries: '../../../apps/server/src/db/schema.ts#Summary',
        },
        // graphql-scalars' DateTime hands resolvers Date objects.
        scalars: { DateTime: 'Date' },
        useTypeImports: true,
        // verbatimModuleSyntax: the emitted imports must carry the extension.
        emitLegacyCommonJSImports: false,
      },
    },
    'src/agent-sdk.ts': clientSdk('../agent/src/operations.graphql'),
    'src/web-sdk.ts': clientSdk('../../apps/web/src/operations.graphql'),
  },
};

export default config;
