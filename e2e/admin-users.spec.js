import { test, expect } from '@playwright/test';

test('super admin invites a new user from the admin shell', async ({ page }) => {
  await page.goto('/#/admin/users');
  await expect(page.getByRole('heading', { name: 'Users' })).toBeVisible();

  await page.getByRole('button', { name: 'Invite user' }).click();
  const stamp = `invitee+${Date.now()}@e2e.local`;
  await page.locator('input[aria-label="Email"]').fill(stamp);
  await page.getByRole('button', { name: 'Send invite' }).click();

  await expect(page.locator('.toast-info', { hasText: 'Invite sent' })).toBeVisible();
  await expect(page.locator('.admin-table').getByText(stamp)).toBeVisible();
});

test('super admin can disable and re-enable a user', async ({ page }) => {
  await page.goto('/#/admin/users');
  await page.locator('input[aria-label="Search users"]').fill('developer@e2e.local');
  await expect(page.locator('.admin-table tbody tr')).toHaveCount(1);

  await page.getByRole('button', { name: 'Disable' }).click();
  await page.getByRole('button', { name: 'Disable' }).last().click(); // confirm modal
  await expect(page.locator('.toast-info', { hasText: 'User disabled' })).toBeVisible();
  await expect(page.locator('.admin-table .role-badge', { hasText: 'disabled' })).toBeVisible();

  await page.getByRole('button', { name: 'Enable' }).click();
  await expect(page.locator('.toast-info', { hasText: 'User enabled' })).toBeVisible();
});
