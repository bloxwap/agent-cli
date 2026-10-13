import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    setupFiles: ['test/setup.ts'],
    exclude: ['test/*.integration.test.ts', 'node_modules/**'],
  },
});
