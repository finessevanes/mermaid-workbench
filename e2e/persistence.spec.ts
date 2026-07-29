import { expect, test } from '@playwright/test';

test('creates, renders, saves, and reloads a local diagram', async ({
  page,
}) => {
  await page.goto('/');

  await page
    .getByRole('button', { name: 'Create your first project' })
    .click();
  await page.getByLabel('Project name').fill('Launch maps');
  await page.getByRole('button', { name: 'Create project' }).click();

  await page.getByRole('button', { name: 'New diagram' }).click();
  await page.getByLabel('Diagram title').fill('Release path');
  await page.getByRole('button', { name: 'Create diagram' }).click();

  const source = 'flowchart LR\n  Idea --> Build --> Ship';
  await page.getByLabel('Mermaid source').fill(source);
  await expect(page.getByRole('status')).toContainText('Unsaved changes');
  await expect(page.getByRole('status')).toContainText('Saved');
  await expect(
    page.locator('[data-testid="mermaid-preview"] svg'),
  ).toBeVisible();

  await page.reload();
  await page.getByRole('button', { name: 'Open Release path' }).click();
  await expect(page.getByLabel('Mermaid source')).toHaveValue(source);
  await expect(
    page.locator('[data-testid="mermaid-preview"] svg'),
  ).toBeVisible();
});
