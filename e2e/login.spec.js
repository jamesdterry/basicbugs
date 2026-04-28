import { test, expect } from '@playwright/test';

test('login fails with wrong password', async ({ page }) => {
  await page.goto('/login.html');
  await page.locator('#password-form input[name="email"]').fill('developer@e2e.local');
  await page.locator('#password-form input[name="password"]').fill('definitely-wrong');
  await page.locator('#password-form button[type="submit"]').click();

  const status = page.locator('#status');
  await expect(status).toBeVisible();
  await expect(status).toHaveText(/incorrect/i);
  await expect(page).toHaveURL(/\/login\.html$/);
});

test('login succeeds with correct password and lands on app shell', async ({ page }) => {
  await page.goto('/login.html');
  await page.locator('#password-form input[name="email"]').fill('developer@e2e.local');
  await page.locator('#password-form input[name="password"]').fill('developer-pass-1');
  await page.locator('#password-form button[type="submit"]').click();

  await page.waitForURL('/');
  await expect(page.locator('#app-root')).toBeVisible();
});
