import { test, expect } from '@playwright/test';

test('authed user reaches the seeded issue from the app shell', async ({ page }) => {
  await page.goto('/');

  // With a single seeded project, app.js auto-redirects from #/ to #/projects/:id
  // and renders the project home with its issue list.
  await expect(page.locator('#app-root')).toBeVisible();
  await expect(page.getByText('Smoke test issue')).toBeVisible();
});
