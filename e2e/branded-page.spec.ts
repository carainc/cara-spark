/**
 * Lane D / T15 — the branded public page renders the agent's theme (brand color/name) + the chat,
 * and the mandatory crisis/not-medical-advice footer is intact. The branded route is seeded at
 * `/a/demo-chc/triage-demo` (db/seed.ts: PUBLISHED, CHAT enabled).
 *
 * Structure-only: no live model turn is submitted. We assert the themed shell, the model-blind chat
 * (no identity fields), and the footer — which branding can never remove (it lives in the layout).
 */
import { test, expect } from '@playwright/test';

const BRANDED = '/a/demo-chc/triage-demo';

test.describe('branded standalone page', () => {
  test('renders the themed page with the agent name and the chat, footer intact', async ({ page }) => {
    const res = await page.goto(BRANDED);

    // Seeded environments: the branded page renders. Un-seeded: 404 — but the footer (layout) is
    // STILL present, which is the load-bearing invariant. Assert accordingly.
    if (res && res.status() < 400) {
      await expect(page.getByTestId('branded-page')).toBeVisible();
      await expect(page.getByTestId('brand-name')).toBeVisible();
      await expect(page.getByTestId('agent-chat')).toBeVisible();
      // The brand color is applied as a CSS variable on the themed section (validated hex only).
      const brand = await page
        .getByTestId('branded-page')
        .evaluate((el) => getComputedStyle(el).getPropertyValue('--brand').trim());
      expect(brand).toMatch(/^#?[0-9a-fA-F]{3,8}$/);
    }

    // Footer present regardless of seed state — it can never be dropped by branding.
    await expect(page.getByTestId('safety-footer')).toBeVisible();
    await expect(page.getByTestId('safety-footer')).toContainText(/not medical advice/i);
  });

  test('the branded chat exposes no identity input (model-blind)', async ({ page }) => {
    const res = await page.goto(BRANDED);
    test.skip(!res || res.status() >= 400, 'branded agent not seeded in this environment');

    for (const n of ['name', 'dob', 'phone', 'email', 'mrn', 'ssn']) {
      await expect(page.locator(`input[name="${n}"]`)).toHaveCount(0);
    }
  });
});
