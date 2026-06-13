/**
 * Lane D — the crisis/not-medical-advice footer renders on EVERY route (OSS law §4: it lives at the
 * layout level, so it is structurally impossible to ship a page without it). This spec walks the
 * public routes and asserts the footer testid + the not-medical-advice text, in EN and ES.
 *
 * Structure-only: no live model is exercised (we never submit a chat turn here).
 */
import { test, expect } from '@playwright/test';

// Public, unauthenticated routes Lane D owns or touches. (Console routes are auth-guarded → covered
// by the structural assertion that the footer is in the shared layout, exercised on these pages.)
const ROUTES = ['/', '/agent', '/login'];

test.describe('not-medical-advice + crisis footer on every route', () => {
  for (const route of ROUTES) {
    test(`footer present on ${route}`, async ({ page }) => {
      await page.goto(route);
      const footer = page.getByTestId('safety-footer');
      await expect(footer).toBeVisible();
      // The not-medical-advice notice + a crisis resource must be present.
      await expect(footer).toContainText(/not medical advice/i);
      await expect(footer).toContainText('988');
    });
  }

  test('footer is bilingual — ES copy after toggling the language cookie', async ({ page, context }) => {
    await context.addCookies([
      { name: 'cara_lang', value: 'es', url: 'http://localhost:3000' },
    ]);
    await page.goto('/agent');
    const footer = page.getByTestId('safety-footer');
    await expect(footer).toBeVisible();
    await expect(footer).toContainText(/no es consejo médico/i);
  });
});
