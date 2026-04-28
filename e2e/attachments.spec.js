import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';
import { createIssueViaApi, gotoIssue, uniqueName } from './helpers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PNG_PATH = path.join(__dirname, 'fixtures', 'sample.png');
const PDF_PATH = path.join(__dirname, 'fixtures', 'sample.pdf');

test.describe('attachments', () => {
  test('uploads PNG and PDF on the issue detail page; PNG renders as thumbnail', async ({
    page,
  }) => {
    const issue = await createIssueViaApi(page, { name: uniqueName('att-upload') });
    await gotoIssue(page, issue.projectId, issue.number);

    const section = page.locator('.issue-detail-attachments');
    await expect(section).toBeVisible();
    await expect(section.getByRole('heading', { name: /Attachments/ })).toBeVisible();

    const fileInput = section.locator('.dropzone input[type="file"]');
    await fileInput.setInputFiles([PNG_PATH, PDF_PATH]);

    const cards = page.locator('.attachments-grid .attachment-card');
    await expect(cards).toHaveCount(2);

    const pngCard = cards.filter({ hasText: 'sample.png' });
    await expect(pngCard.locator('img.attachment-thumb')).toBeVisible();

    const pdfCard = cards.filter({ hasText: 'sample.pdf' });
    await expect(pdfCard.locator('.attachment-icon')).toBeVisible();
  });

  test('uploader can archive their own attachment and it disappears from the list', async ({
    page,
  }) => {
    const issue = await createIssueViaApi(page, { name: uniqueName('att-archive') });
    await gotoIssue(page, issue.projectId, issue.number);

    const section = page.locator('.issue-detail-attachments');
    await expect(section).toBeVisible();
    const cards = page.locator('.attachments-grid .attachment-card');
    // Each test owns a fresh issue, so the baseline is zero attachments.
    await expect(cards).toHaveCount(0);

    await section.locator('.dropzone input[type="file"]').setInputFiles(PNG_PATH);
    await expect(cards).toHaveCount(1);

    const target = cards.filter({ hasText: 'sample.png' }).first();
    await target.hover();
    await target.getByRole('button', { name: /Archive/ }).click({ force: true });

    await expect(cards).toHaveCount(0);
  });

  test('new-issue modal accepts a file attachment that lands on the created issue', async ({
    page,
  }) => {
    // Anchor on the issue-list URL of the seeded project so we don't depend on
    // hash-router auto-redirect behavior under parallel state churn.
    await page.goto('/#/projects/1');
    await expect(page.locator('.issue-list')).toBeVisible();

    await page.getByRole('button', { name: /\+ New issue/ }).click();
    const dialog = page.getByRole('dialog');
    const name = uniqueName('att-modal');
    await dialog.locator('input[name="name"]').fill(name);
    await dialog.locator('.dropzone input[type="file"]').setInputFiles(PNG_PATH);
    await expect(dialog.locator('.dropzone-pending-item')).toHaveCount(1);
    await dialog.getByRole('button', { name: /Create issue/i }).click();

    await expect(page).toHaveURL(/#\/projects\/\d+\/issues\/\d+/);
    await expect(page.getByRole('heading', { level: 1 })).toContainText(name);
    const cards = page.locator('.attachments-grid .attachment-card');
    await expect(cards).toHaveCount(1);
    await expect(cards.first()).toContainText('sample.png');
  });
});
