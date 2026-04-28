import { test, expect } from '@playwright/test';
import { createIssueViaApi, gotoIssue, uniqueName } from './helpers.js';

test.describe('Stage 10 — notifications UI', () => {
  test('notification bell renders in the top bar', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.notif-bell-trigger')).toBeVisible();
  });

  test('opening the bell shows the panel and Mark all read', async ({ page }) => {
    await page.goto('/');
    await page.locator('.notif-bell-trigger').click();
    await expect(page.locator('.notif-panel')).toBeVisible();
    await expect(page.locator('.notif-mark-all')).toBeVisible();
    await expect(page.locator('.notif-settings-link')).toBeVisible();
  });

  test('issue detail shows watch toggle and survives a round-trip', async ({ page }) => {
    const issue = await createIssueViaApi(page, { name: uniqueName('watch') });
    await gotoIssue(page, issue.projectId, issue.number);
    const btn = page.locator('.watch-btn');
    await expect(btn).toBeVisible();
    // Newly-created issue auto-watches the author.
    await expect(btn).toContainText(/Watching/);

    await btn.click();
    await expect(btn).toContainText(/^Watch$/);

    await btn.click();
    await expect(btn).toContainText(/Watching/);
  });

  test('profile Notifications tab persists pref toggle', async ({ page }) => {
    await page.goto('/#/me?tab=notifications');
    const checkboxes = page.locator('.pref-checkbox');
    await expect(checkboxes.first()).toBeVisible();

    // Toggle the first pref off.
    const first = checkboxes.first();
    const before = await first.isChecked();
    await first.click();
    await expect(page.locator('.toast-info', { hasText: 'Saved' })).toBeVisible();

    // Reload and confirm it stuck.
    await page.goto('/#/me?tab=notifications');
    await expect(checkboxes.first()).toBeVisible();
    const after = await checkboxes.first().isChecked();
    expect(after).toBe(!before);

    // Restore so we don't poison parallel tests.
    await checkboxes.first().click();
  });
});
