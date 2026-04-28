import { test as setup, expect } from '@playwright/test';

const STORAGE_STATE = '.auth/superadmin.json';

setup('authenticate as super admin', async ({ page }) => {
  await page.goto('/login.html');
  await page.locator('#password-form input[name="email"]').fill('admin@e2e.local');
  await page.locator('#password-form input[name="password"]').fill('admin-pass-1');
  await page.locator('#password-form button[type="submit"]').click();

  await page.waitForURL('/');
  await expect(page.locator('#app-root')).toBeVisible();

  await page.context().storageState({ path: STORAGE_STATE });
});
