import { test, expect } from '@playwright/test';
import { uniqueSuffix } from './helpers.js';

test('super admin invites a new user from the admin shell', async ({ page }) => {
  await page.goto('/#/admin/users');
  await expect(page.getByRole('heading', { name: 'Users' })).toBeVisible();

  await page.getByRole('button', { name: 'Invite user' }).click();
  const stamp = `invitee+${uniqueSuffix()}@e2e.local`;
  await page.locator('input[aria-label="Email"]').fill(stamp);
  await page.getByRole('button', { name: 'Send invite' }).click();

  await expect(page.locator('.toast-info', { hasText: 'Invite sent' })).toBeVisible();
  await expect(page.locator('.admin-table').getByText(stamp)).toBeVisible();
});

test('super admin can disable and re-enable a user', async ({ page }) => {
  // Don't target developer@e2e.local — the authed worker depends on that
  // session, and disabling them mid-run logs them out and redirects to
  // /login.html. Create a disposable user via the invite flow and operate on
  // them instead.
  await page.goto('/#/admin/users');
  const email = `disable-target+${uniqueSuffix()}@e2e.local`;
  await page.getByRole('button', { name: 'Invite user' }).click();
  await page.locator('input[aria-label="Email"]').fill(email);
  await page.getByRole('button', { name: 'Send invite' }).click();
  await expect(page.locator('.toast-info', { hasText: 'Invite sent' })).toBeVisible();

  await page.locator('input[aria-label="Search users"]').fill(email);
  await expect(page.locator('.admin-table tbody tr')).toHaveCount(1);

  await page.getByRole('button', { name: 'Disable' }).click();
  await page.getByRole('button', { name: 'Disable' }).last().click(); // confirm modal
  await expect(page.locator('.toast-info', { hasText: 'User disabled' })).toBeVisible();
  await expect(page.locator('.admin-table .role-badge', { hasText: 'disabled' })).toBeVisible();

  await page.getByRole('button', { name: 'Enable' }).click();
  await expect(page.locator('.toast-info', { hasText: 'User enabled' })).toBeVisible();
});
