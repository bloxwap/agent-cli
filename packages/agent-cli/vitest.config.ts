import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    // Durability regressions use real fsync; bound concurrent disk writers.
    maxWorkers: 4,
    testTimeout: 15_000,
    setupFiles: ['test/setup.ts'],
    exclude: ['test/*.integration.test.ts', 'node_modules/**'],
  },
});
