import type { CodegenConfig } from '@graphql-codegen/cli';

// Regenerate with `npm run codegen` at the repo root. Output is committed, for
// the same reason the clients' is: src/gql/resolvers.ts is what types every
// hand-written resolver in src/graphql, so a schema change that a resolver
// hasn't caught up with is a typecheck failure rather than a runtime surprise.
//
// The input is the printed /schema.graphql, which is this server's own output —
// a fixpoint, not a spec. That is fine because the half it types is authored:
// the domain fields come from src/graphql/domain.graphql, and codegen turns
// them into the argument and return types their resolvers are checked against.
// The generated half (drizzle-graphql) contributes the row types those
// resolvers hand back.
//
// Chicken-and-egg on a cold checkout is not a problem: resolvers.ts is only
// ever imported with `import type`, which tsx erases, so schema:print still
// runs when this file is missing or stale.
const config: CodegenConfig = {
  schema: '../../schema.graphql',
  generates: {
    'src/gql/resolvers.ts': {
      plugins: ['typescript', 'typescript-resolvers'],
      config: {
        contextType: '../graphql/context.ts#Context',
        // Resolvers hand back Drizzle rows, not the GraphQL shape: the row is
        // what the database returned, and the field resolvers read columns off
        // it. Mapping each generated type to its row type is what makes
        // `return row` type-check — and what makes returning the wrong table's
        // row an error.
        mappers: {
          Activities: '../activity/fold.ts#Activity',
          CategoryRules: '../activity/rules.ts#CategoryRule',
          ContextRules: '../activity/context.ts#ContextRule',
          MergeRules: '../activity/merge-rules.ts#MergeRule',
          Categories: '../db/schema.ts#Category',
          Devices: '../db/schema.ts#Device',
          Summaries: '../db/schema.ts#Summary',
        },
        // graphql-scalars' DateTime hands resolvers Date objects.
        scalars: {
          DateTime: 'Date',
        },
        useTypeImports: true,
        // verbatimModuleSyntax: the emitted imports must carry the extension.
        emitLegacyCommonJSImports: false,
      },
    },
  },
};

export default config;
