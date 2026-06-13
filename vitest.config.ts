import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    // Unit tests only — Playwright e2e lives in ./e2e and runs via `pnpm e2e`.
    include: ['engine/**/*.test.ts', 'lib/**/*.test.ts', 'tests/**/*.test.ts'],
    exclude: ['node_modules', '.next', 'e2e', 'terraform'],
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./', import.meta.url)),
    },
  },
});
