import { defineConfig } from 'vitest/config';

// The only two directories here that hold tests. Saying so keeps vitest from
// walking android/ and dist-web/, which are generated and have nothing to run.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'electron/**/*.test.ts'],
  },
});
