import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.SMOKE_URL ?? process.env.AUTH_URL ?? 'http://localhost:3000';

// e2e/release gate (THIN per runbook): flows, escalation, model-blind grep-absent,
// crisis footer on every page. Runs at integration, not per-commit.
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  use: {
    baseURL,
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
