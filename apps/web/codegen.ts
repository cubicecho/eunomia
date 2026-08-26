import type { CodegenConfig } from '@graphql-codegen/cli';

// Regenerate with `npm run codegen` at the repo root (prints the server SDL to
// /schema.graphql, then runs this). Output is committed: src/gql/sdk.ts is the
// typed contract the dashboard consumes, so a server schema change surfaces as
// a typecheck failure here instead of an empty chart in the browser.
//
// documentMode 'string' for the same reason the agent uses it, minus the
// strip-only constraint: the operations ship as plain strings, which keeps the
// `graphql` package out of the browser bundle entirely.
//
// No `typescript` plugin, unlike the agent's config. The dashboard passes no
// input objects as variables (the one orderBy it needs is written inline in the
// document), so the whole generated filter/order-by surface — a thousand lines
// of it — would be dead weight. Leaving it out also sidesteps a collision:
// typescript-operations re-declares any enum an operation selects unless the
// schema types come from another file, so with both plugins writing here,
// selecting Devices.platform emits DevicesPlatformEnum twice.
const config: CodegenConfig = {
  schema: '../../schema.graphql',
  documents: 'src/operations.graphql',
  generates: {
    'src/gql/sdk.ts': {
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
        'typescript-operations',
        'typescript-generic-sdk',
      ],
      config: {
        documentMode: 'string',
        enumsAsTypes: true,
        scalars: {
          DateTime: 'string',
        },
      },
    },
  },
};

export default config;
