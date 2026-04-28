import { test as setup, expect } from '@playwright/test';

const STORAGE_STATE = '.auth/developer.json';

setup('authenticate as developer', async ({ page }) => {
  await page.goto('/login.html');
  await page.locator('#password-form input[name="email"]').fill('developer@e2e.local');
  await page.locator('#password-form input[name="password"]').fill('developer-pass-1');
  await page.locator('#password-form button[type="submit"]').click();

  await page.waitForURL('/');
  await expect(page.locator('#app-root')).toBeVisible();

  await page.context().storageState({ path: STORAGE_STATE });
});
