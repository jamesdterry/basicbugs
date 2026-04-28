import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PNG_PATH = path.join(__dirname, 'fixtures', 'sample.png');
const PDF_PATH = path.join(__dirname, 'fixtures', 'sample.pdf');

test.describe('attachments', () => {
  test('uploads PNG and PDF on the issue detail page; PNG renders as thumbnail', async ({
    page,
  }) => {
    await page.goto('/');
    await page.getByRole('link', { name: /Smoke test issue/ }).click();
    await expect(page).toHaveURL(/#\/projects\/\d+\/issues\/\d+/);

    const section = page.locator('.issue-detail-attachments');
    await expect(section).toBeVisible();
    await expect(section.getByRole('heading', { name: /Attachments/ })).toBeVisible();

    // The immediate-mode dropzone is the one inside the attachments section.
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
    await page.goto('/');
    await page.getByRole('link', { name: /Smoke test issue/ }).click();

    const section = page.locator('.issue-detail-attachments');
    const cards = page.locator('.attachments-grid .attachment-card');
    // Wait for the page (and any prior uploads) to settle, then snapshot.
    await expect(section).toBeVisible();
    const baseline = await cards.count();

    await section.locator('.dropzone input[type="file"]').setInputFiles(PNG_PATH);
    await expect(cards).toHaveCount(baseline + 1);

    const target = cards.filter({ hasText: 'sample.png' }).last();
    await target.hover();
    await target.getByRole('button', { name: /Archive/ }).click({ force: true });

    await expect(cards).toHaveCount(baseline);
  });

  test('new-issue modal accepts a file attachment that lands on the created issue', async ({
    page,
  }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /\+ New issue/ }).click();
    const dialog = page.getByRole('dialog');
    await dialog.locator('input[name="name"]').fill('Issue with file');
    await dialog.locator('.dropzone input[type="file"]').setInputFiles(PNG_PATH);
    // Confirm the staged file is shown in the pending list before submitting.
    await expect(dialog.locator('.dropzone-pending-item')).toHaveCount(1);
    await dialog.getByRole('button', { name: /Create issue/i }).click();

    await expect(page).toHaveURL(/#\/projects\/\d+\/issues\/\d+/);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Issue with file');
    const cards = page.locator('.attachments-grid .attachment-card');
    await expect(cards).toHaveCount(1);
    await expect(cards.first()).toContainText('sample.png');
  });
});
