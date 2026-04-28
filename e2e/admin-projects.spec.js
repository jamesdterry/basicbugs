import { test, expect } from '@playwright/test';

test('super admin creates a project, renames it, archives it', async ({ page }) => {
  await page.goto('/#/admin/projects');
  await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible();

  const stamp = `Stage8 Test ${Date.now()}`;
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.locator('input[aria-label="Project name"]').fill(stamp);
  await page.getByRole('button', { name: 'Create' }).last().click();
  await expect(page.locator('.toast-info', { hasText: 'Project created' })).toBeVisible();
  await expect(page.locator('.admin-table').getByText(stamp)).toBeVisible();

  // Rename.
  const row = page.locator('.admin-table tbody tr').filter({ hasText: stamp });
  await row.getByRole('button', { name: 'Rename' }).click();
  const renamed = stamp + ' (renamed)';
  await page.locator('input[aria-label="Project name"]').fill(renamed);
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('.admin-table').getByText(renamed)).toBeVisible();

  // Archive.
  const renamedRow = page.locator('.admin-table tbody tr').filter({ hasText: renamed });
  await renamedRow.getByRole('button', { name: 'Archive' }).click();
  await page.getByRole('button', { name: 'Archive' }).last().click(); // confirm
  await expect(page.locator('.toast-info', { hasText: 'Archived' })).toBeVisible();
});
