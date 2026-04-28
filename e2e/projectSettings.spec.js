import { test, expect } from '@playwright/test';
import { uniqueSuffix } from './helpers.js';

test.describe('Project Settings (developer view)', () => {
  test('reorders a status with the up/down buttons and persists across reload', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#app-root')).toBeVisible();

    await page.getByRole('link', { name: 'Settings' }).first().click();
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Settings');

    await page.getByRole('tab', { name: 'Statuses' }).click();

    const beforeNames = await page.locator('.metadata-row .rename-display').allTextContents();
    expect(beforeNames.length).toBeGreaterThan(2);
    const firstName = beforeNames[0];
    const secondName = beforeNames[1];

    // Move the first status down via the down arrow on its row.
    const firstRow = page.locator('.metadata-row').first();
    await firstRow.getByRole('button', { name: `Move ${firstName} down` }).click();

    await expect.poll(async () => {
      const names = await page.locator('.metadata-row .rename-display').allTextContents();
      return names[0];
    }).toBe(secondName);

    // Persists after reload.
    await page.reload();
    await page.getByRole('tab', { name: 'Statuses' }).click();
    const afterReload = await page.locator('.metadata-row .rename-display').allTextContents();
    expect(afterReload[0]).toBe(secondName);

    // Restore order so other tests are not surprised.
    await page
      .locator('.metadata-row')
      .filter({ has: page.getByRole('button', { name: `Move ${firstName} up` }) })
      .getByRole('button', { name: `Move ${firstName} up` })
      .click();
  });

  test('adds and renames a custom category', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: 'Settings' }).first().click();
    await page.getByRole('tab', { name: 'Categories' }).click();

    const addInput = page.locator('.metadata-add input');
    const stamp = `Cat-${uniqueSuffix()}`;
    await addInput.fill(stamp);
    await page.locator('.metadata-add button', { hasText: 'Add' }).click();
    await expect(page.locator('.metadata-row').filter({ hasText: stamp })).toBeVisible();

    // Rename it.
    const newName = `${stamp}-renamed`;
    await page
      .locator('.metadata-row')
      .filter({ hasText: stamp })
      .locator('.rename-display')
      .click();
    const input = page.locator('.rename-input');
    await expect(input).toBeVisible();
    await input.fill(newName);
    await input.press('Enter');
    await expect(page.locator('.metadata-row').filter({ hasText: newName })).toBeVisible();

    // Archive it (cleanup).
    await page
      .locator('.metadata-row')
      .filter({ hasText: newName })
      .getByRole('button', { name: `Archive ${newName}` })
      .click();
    await page.getByRole('button', { name: 'Archive' }).last().click();
    await expect(page.locator('.metadata-row').filter({ hasText: newName })).toHaveCount(0);
  });
});
