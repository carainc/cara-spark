import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    // Unit tests only — Playwright e2e lives in ./e2e and runs via `pnpm e2e`.
    include: ['engine/**/*.test.ts', 'lib/**/*.test.ts', 'tests/**/*.test.ts'],
    exclude: ['node_modules', '.next', 'e2e', 'terraform'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary', 'json-summary', 'html'],
      reportsDirectory: './coverage',
      // The unit-testable core. UI (.tsx) is Playwright-e2e territory; lib/auth.ts and lib/db.ts are
      // framework/config wiring. The RAG IO boundaries (pg-store/embeddings) are covered via injected
      // doubles (tk-0021) and are now enforced.
      include: ['engine/**/*.ts', 'lib/**/*.ts', 'app/api/**/*.ts'],
      exclude: [
        '**/*.test.ts',
        '**/__tests__/**',
        '**/types.ts',
        '**/*.d.ts',
        'lib/i18n/**',
        'lib/db.ts',
        'lib/auth.ts',
        // External-IO boundary — framework wiring, not unit-mockable:
        'app/api/auth/**', // NextAuth handler re-export (framework wiring)
      ],
      // A regression floor, set comfortably below current (94% lines / 85% branches) so it
      // enforces without flaking. Ratchet up as the IO-boundary integration tests land.
      thresholds: {
        statements: 90,
        lines: 90,
        functions: 88,
        branches: 80,
      },
    },
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./', import.meta.url)),
    },
  },
});
