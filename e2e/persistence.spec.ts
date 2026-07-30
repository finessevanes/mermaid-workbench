import { expect, test } from '@playwright/test';

test('persists an interactive flowchart layout and keeps unsupported diagrams static', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');

  await page
    .getByRole('button', { name: 'Create your first project' })
    .click();
  await page.getByLabel('Project name').fill('Launch maps');
  await page.getByRole('button', { name: 'Create project' }).click();

  const source = 'flowchart LR\n  idea[Idea] --> ship((Ship))';
  await page.getByLabel('Import .mmd').setInputFiles({
    name: 'Release path.mmd',
    mimeType: 'text/plain',
    buffer: Buffer.from(source),
  });

  const interactiveCanvas = page.getByRole('region', {
    name: 'Interactive flowchart',
  });
  await expect(interactiveCanvas).toBeVisible();
  await expect(page.getByLabel('Mermaid source')).toHaveValue(source);

  const ideaNode = page.locator('.react-flow__node[data-id="idea"]');
  const edgePath = page.locator(
    '.react-flow__edge[data-id="edge|idea|ship|0"] path.react-flow__edge-path',
  );
  await expect(ideaNode).toBeVisible();
  await expect(edgePath).toHaveAttribute('d', /\S/);

  const initialIdeaBox = await ideaNode.boundingBox();
  expect(initialIdeaBox).not.toBeNull();
  const initialEdgePath = await edgePath.getAttribute('d');
  expect(initialEdgePath).not.toBeNull();

  const dragDistance = 160;
  await page.mouse.move(
    initialIdeaBox!.x + initialIdeaBox!.width / 2,
    initialIdeaBox!.y + initialIdeaBox!.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    initialIdeaBox!.x + initialIdeaBox!.width / 2 + dragDistance,
    initialIdeaBox!.y + initialIdeaBox!.height / 2,
    { steps: 12 },
  );
  await page.mouse.up();

  let draggedIdeaBox = initialIdeaBox!;
  await expect(async () => {
    const nextIdeaBox = await ideaNode.boundingBox();
    expect(nextIdeaBox).not.toBeNull();
    draggedIdeaBox = nextIdeaBox!;
    expect(
      Math.hypot(
        draggedIdeaBox.x - initialIdeaBox!.x,
        draggedIdeaBox.y - initialIdeaBox!.y,
      ),
    ).toBeGreaterThanOrEqual(120);
    expect(await edgePath.getAttribute('d')).not.toBe(initialEdgePath);
  }).toPass();

  const saveStatus = page.getByRole('status', { name: 'Save status' });
  await expect(saveStatus).toContainText('Unsaved changes');
  await expect(saveStatus).toContainText('Saved');

  await page.reload();
  await page.getByRole('button', { name: 'Open Release path' }).click();
  await expect(interactiveCanvas).toBeVisible();

  const restoredIdeaBox = await ideaNode.boundingBox();
  expect(restoredIdeaBox).not.toBeNull();
  expect(Math.abs(restoredIdeaBox!.x - draggedIdeaBox.x)).toBeLessThanOrEqual(2);
  expect(Math.abs(restoredIdeaBox!.y - draggedIdeaBox.y)).toBeLessThanOrEqual(2);

  const resetAccepted = new Promise<void>((resolve, reject) => {
    page.once('dialog', async (dialog) => {
      try {
        expect(dialog.type()).toBe('confirm');
        expect(dialog.message()).toBe(
          'Reset all manually positioned nodes to an automatic layout?',
        );
        await dialog.accept();
        resolve();
      } catch (error) {
        reject(error);
      }
    });
  });
  await page.getByRole('button', { name: 'Reset layout' }).click();
  await resetAccepted;

  await expect(async () => {
    const resetIdeaBox = await ideaNode.boundingBox();
    expect(resetIdeaBox).not.toBeNull();
    expect(
      Math.hypot(
        resetIdeaBox!.x - restoredIdeaBox!.x,
        resetIdeaBox!.y - restoredIdeaBox!.y,
      ),
    ).toBeGreaterThan(2);
  }).toPass();
  await expect(saveStatus).toContainText('Saved');

  await page.getByRole('button', { name: 'Library' }).click();
  const sequenceSource = 'sequenceDiagram\n  Alice->>Bob: Hello';
  await page.getByLabel('Import .mmd').setInputFiles({
    name: 'Sequence path.mmd',
    mimeType: 'text/plain',
    buffer: Buffer.from(sequenceSource),
  });

  await expect(
    page.getByText('Interactive layout unavailable'),
  ).toBeVisible();
  await expect(
    page.getByText('Only Mermaid flowcharts support interactive mode.'),
  ).toBeVisible();
  await expect(
    page.locator('[data-testid="mermaid-preview"] svg'),
  ).toBeVisible();
  await expect(interactiveCanvas).toHaveCount(0);
});
