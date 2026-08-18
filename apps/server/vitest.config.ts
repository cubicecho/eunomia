import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // graphql ships dual CJS/ESM builds without an `exports` map. Vite resolves
    // our imports to the .mjs build while externalized deps (drizzle-graphql,
    // graphql-casl, ...) get the CJS build from Node — two realms, and graphql's
    // instanceof checks throw "from another module or realm". Pin vite-processed
    // imports to the CJS entry so every consumer shares one instance.
    alias: { graphql: 'graphql/index.js' },
  },
  test: {
    // Each test file boots its own in-process PGlite; under parallel file
    // execution cold starts can outrun the 5s default.
    testTimeout: 30_000,
  },
});
