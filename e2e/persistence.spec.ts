import { expect, test } from '@playwright/test';

test('creates, renders, saves, and reloads a local diagram', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
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
  await expect(
    page.getByRole('status', { name: 'Save status' }),
  ).toContainText('Unsaved changes');
  await expect(
    page.getByRole('status', { name: 'Save status' }),
  ).toContainText('Saved');
  await expect(
    page.locator('[data-testid="mermaid-preview"] svg'),
  ).toBeVisible();

  const previewRegion = page.getByRole('region', { name: 'Diagram preview' });
  const previewLayer = page.getByTestId('preview-transform');
  const expandedPreviewWidth = (await previewRegion.boundingBox())?.width ?? 0;

  await page.getByRole('button', { name: 'Collapse source' }).click();
  await expect(
    page.getByRole('button', { name: 'Expand source' }),
  ).toBeFocused();
  const collapsedPreviewWidth = (await previewRegion.boundingBox())?.width ?? 0;
  expect(collapsedPreviewWidth).toBeGreaterThan(expandedPreviewWidth);

  await page
    .getByRole('button', { name: 'Reset zoom to 100%' })
    .click();
  await page.getByRole('button', { name: 'Zoom in' }).click();
  await expect(
    page.getByRole('status', { name: 'Zoom level' }),
  ).toHaveText('110%');
  await expect(previewLayer).toHaveCSS(
    'transform',
    /matrix\(1\.1, 0, 0, 1\.1,/,
  );

  await page.setViewportSize({ width: 800, height: 900 });
  const compactSource = page.locator('.workspace-panel--source-collapsed');
  const compactBounds = await compactSource.boundingBox();
  expect(compactBounds?.width ?? 0).toBeGreaterThan(
    compactBounds?.height ?? Number.POSITIVE_INFINITY,
  );

  await page.getByRole('button', { name: 'Expand source' }).click();
  await expect(page.getByLabel('Mermaid source')).toHaveValue(source);

  await page.reload();
  await page.getByRole('button', { name: 'Open Release path' }).click();
  await expect(page.getByLabel('Mermaid source')).toHaveValue(source);
  await expect(
    page.locator('[data-testid="mermaid-preview"] svg'),
  ).toBeVisible();
});
