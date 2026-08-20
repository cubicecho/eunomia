import type { CodegenConfig } from '@graphql-codegen/cli';

// Regenerate with `npm run codegen` at the repo root (prints the server SDL,
// then runs this). Output is committed: schema.graphql + src/gql/sdk.ts are
// the runtime contract every agent consumes.
//
// Constraint: the generated file must survive Node's strip-only type
// stripping (electron runs the desktop agent straight from TS source), so no
// TS enums (enumsAsTypes) and string documents instead of DocumentNode
// (documentMode: 'string' — also keeps `graphql` out of the runtime deps).
const config: CodegenConfig = {
  schema: 'schema.graphql',
  documents: 'src/operations.graphql',
  generates: {
    'src/gql/sdk.ts': {
      plugins: [
        {
          // typescript-generic-sdk with documentMode 'string' emits
          // `new TypedDocumentString(...)` but leaves the definition to the
          // client-preset runtime, which we don't use — supply a minimal one.
          // The `declare` field keeps it erasable under strip-only stripping.
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
        'typescript',
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
