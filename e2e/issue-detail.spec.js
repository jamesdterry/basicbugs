import { test, expect } from '@playwright/test';
import { createIssueViaApi, gotoIssue, uniqueName } from './helpers.js';

test.describe('issue detail', () => {
  test('renders header, sidebar, and history for a freshly-created issue', async ({ page }) => {
    const issue = await createIssueViaApi(page, { name: uniqueName('detail-render') });
    await gotoIssue(page, issue.projectId, issue.number);

    await expect(page.getByRole('heading', { level: 1 })).toContainText(issue.name);
    await expect(page.locator('.issue-detail-sidebar')).toBeVisible();
    const timeline = page.locator('.history-timeline');
    await expect(timeline).toBeVisible();
    await expect(timeline.locator('.history-event-creation')).toHaveCount(1);
  });

  test('inline edit + note creates a single change event with two field rows', async ({
    page,
  }) => {
    const original = uniqueName('detail-edit');
    const issue = await createIssueViaApi(page, { name: original });
    await gotoIssue(page, issue.projectId, issue.number);

    await page.locator('.field-name').click();
    const renamed = `${original} (edited)`;
    const nameInput = page.locator('.field-editor input');
    await nameInput.fill(renamed);
    await nameInput.press('Enter');

    await page.locator('.issue-detail-sidebar .field-cell').first().click();
    const statusSelect = page.locator('.issue-detail-sidebar .field-editor select').first();
    await statusSelect.selectOption({ label: 'In Progress' });

    const saveBar = page.locator('.save-bar');
    await expect(saveBar).toBeVisible();
    await saveBar.locator('textarea').fill('starting work');
    await saveBar.getByRole('button', { name: /save changes/i }).click();

    await expect(saveBar).toHaveCount(0);
    await expect(page.getByRole('heading', { level: 1 })).toContainText(renamed);

    const events = page.locator('.history-event');
    await expect(events.first()).toHaveClass(/history-event-change/);
    const changeRows = events.first().locator('.history-change-row');
    await expect(changeRows).toHaveCount(2);
    await expect(events.first()).toContainText('starting work');
  });

  test('comment posts a comment-kind history event', async ({ page }) => {
    const issue = await createIssueViaApi(page, { name: uniqueName('detail-comment') });
    await gotoIssue(page, issue.projectId, issue.number);

    await expect(page.locator('.history-timeline')).toBeVisible();
    await expect(page.locator('.history-event-creation')).toHaveCount(1);
    const before = await page.locator('.history-event').count();

    const body = `still seeing this on staging ${uniqueName('msg')}`;
    const commentBox = page.locator('.comment-box textarea');
    await commentBox.fill(body);
    await page.locator('.comment-box').getByRole('button', { name: /post comment/i }).click();

    const events = page.locator('.history-event');
    await expect(events).toHaveCount(before + 1);
    await expect(events.first()).toHaveClass(/history-event-comment/);
    await expect(events.first()).toContainText(body);
  });

  test('+ New issue modal creates an issue and lands on the detail view', async ({ page }) => {
    // Anchor on the issue list URL of the seeded project so we don't depend on
    // hash-router auto-redirect behavior under parallel state churn.
    await page.goto('/#/projects/1');
    await expect(page.locator('.issue-list')).toBeVisible();

    await page.getByRole('button', { name: /\+ New issue/ }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    const name = uniqueName('detail-modal');
    await dialog.locator('input[name="name"]').fill(name);
    await dialog.locator('textarea[name="description"]').fill('Filed via Playwright spec.');
    await dialog.getByRole('button', { name: /create issue/i }).click();

    await expect(page).toHaveURL(/#\/projects\/\d+\/issues\/\d+/);
    await expect(page.getByRole('heading', { level: 1 })).toContainText(name);
    await expect(page.locator('.history-event-creation')).toHaveCount(1);
  });
});
