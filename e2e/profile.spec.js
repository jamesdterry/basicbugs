import { test, expect } from '@playwright/test';

test('developer can change their name from the profile page', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /E2E Developer/ }).click();
  await page.getByRole('menuitem', { name: 'Profile' }).click();

  await expect(page.getByRole('heading', { name: 'Your profile' })).toBeVisible();

  const stamp = `E2E Developer ${Date.now() % 100000}`;
  const nameInput = page.locator('input[aria-label="Display name"]');
  await nameInput.fill(stamp);
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('.toast-info', { hasText: 'Profile updated' })).toBeVisible();

  // Reload and confirm persistence.
  await page.reload();
  await expect(page.locator('input[aria-label="Display name"]')).toHaveValue(stamp);

  // Restore original name so other specs aren't surprised.
  await nameInput.fill('E2E Developer');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('.toast-info', { hasText: 'Profile updated' })).toBeVisible();
});
