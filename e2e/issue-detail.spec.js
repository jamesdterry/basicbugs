import { test, expect } from '@playwright/test';

test.describe('issue detail', () => {
  test('renders header, sidebar, and history for the seeded issue', async ({ page }) => {
    await page.goto('/');

    // Single seeded project auto-redirects to projectHome.
    await page.getByRole('link', { name: /Smoke test issue/ }).click();
    await expect(page).toHaveURL(/#\/projects\/\d+\/issues\/\d+/);

    await expect(page.getByRole('heading', { level: 1 })).toContainText('Smoke test issue');
    await expect(page.locator('.issue-detail-sidebar')).toBeVisible();
    // Creation event in the timeline.
    const timeline = page.locator('.history-timeline');
    await expect(timeline).toBeVisible();
    await expect(timeline.locator('.history-event-creation')).toHaveCount(1);
  });

  test('inline edit + note creates a single change event with two field rows', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: /Smoke test issue/ }).click();

    // Edit the name field.
    await page.locator('.field-name').click();
    const nameInput = page.locator('.field-editor input');
    await nameInput.fill('Smoke test issue (edited)');
    await nameInput.press('Enter');

    // Change the status via the sidebar select.
    await page.locator('.issue-detail-sidebar .field-cell').first().click();
    const statusSelect = page.locator('.issue-detail-sidebar .field-editor select').first();
    await statusSelect.selectOption({ label: 'In Progress' });

    // Save bar appears with both pending changes; add a note and submit.
    const saveBar = page.locator('.save-bar');
    await expect(saveBar).toBeVisible();
    await saveBar.locator('textarea').fill('starting work');
    await saveBar.getByRole('button', { name: /save changes/i }).click();

    // Save bar disappears after a successful save.
    await expect(saveBar).toHaveCount(0);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Smoke test issue (edited)');

    // The new change event groups both rows.
    const events = page.locator('.history-event');
    await expect(events.first()).toHaveClass(/history-event-change/);
    const changeRows = events.first().locator('.history-change-row');
    await expect(changeRows).toHaveCount(2);
    await expect(events.first()).toContainText('starting work');
  });

  test('comment posts a comment-kind history event', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: /Smoke test issue/ }).click();

    // Wait for the timeline to fully load before counting.
    await expect(page.locator('.history-timeline')).toBeVisible();
    await expect(page.locator('.history-event-creation')).toHaveCount(1);
    const before = await page.locator('.history-event').count();

    const commentBox = page.locator('.comment-box textarea');
    await commentBox.fill('still seeing this on staging');
    await page.locator('.comment-box').getByRole('button', { name: /post comment/i }).click();

    const events = page.locator('.history-event');
    await expect(events).toHaveCount(before + 1);
    await expect(events.first()).toHaveClass(/history-event-comment/);
    await expect(events.first()).toContainText('still seeing this on staging');
  });

  test('+ New issue from list creates an issue and lands on the detail view', async ({ page }) => {
    await page.goto('/');
    // Land on project home.
    await expect(page.locator('.issue-list')).toBeVisible();

    await page.getByRole('button', { name: /\+ New issue/ }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    await dialog.locator('input[name="name"]').fill('Created from e2e');
    await dialog.locator('textarea[name="description"]').fill('Filed via Playwright spec.');
    await dialog.getByRole('button', { name: /create issue/i }).click();

    await expect(page).toHaveURL(/#\/projects\/\d+\/issues\/\d+/);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Created from e2e');
    await expect(page.locator('.history-event-creation')).toHaveCount(1);
  });
});
