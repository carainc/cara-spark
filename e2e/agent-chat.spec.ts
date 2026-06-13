/**
 * Lane D / T7 — the agent chat is model-BLIND by construction at the UI layer: the only input is a
 * free-text symptom box (no name / DOB / phone field), and the intro warns the patient not to share
 * identifiers. The not-medical-advice footer is present.
 *
 * Structure-only: we do NOT submit a turn (that would call the live model). We assert the page shape
 * that guarantees model-blindness — there is nowhere on the page to enter PHI.
 */
import { test, expect } from '@playwright/test';

test.describe('agent chat — model-blind UI', () => {
  test('renders a single symptom input and no identity fields', async ({ page }) => {
    await page.goto('/agent');

    const chat = page.getByTestId('agent-chat');
    await expect(chat).toBeVisible();

    // The intro explicitly tells the patient not to share name/DOB.
    await expect(chat).toContainText(/do not share your name or date of birth/i);

    // There must be NO input that asks for an identifier.
    const phiNames = ['name', 'dob', 'date_of_birth', 'dateOfBirth', 'phone', 'email', 'mrn', 'ssn'];
    for (const n of phiNames) {
      await expect(page.locator(`input[name="${n}"]`)).toHaveCount(0);
    }
    // The one input present is the symptom box (aria-labelled by the placeholder copy).
    await expect(page.getByPlaceholder(/symptoms/i)).toBeVisible();
  });

  test('the footer is present on the chat route', async ({ page }) => {
    await page.goto('/agent');
    await expect(page.getByTestId('safety-footer')).toBeVisible();
  });
});
