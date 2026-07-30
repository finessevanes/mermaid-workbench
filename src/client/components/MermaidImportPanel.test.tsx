// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FlowchartCanvasV1 } from '../../shared/flowchart-canvas-schema';
import type {
  FlowchartImportResult,
  ImportedFlowchart,
} from '../flowchart-import';
import { MermaidImportPanel } from './MermaidImportPanel';

const importer = vi.hoisted(() => ({
  actual: undefined as
    | undefined
    | ((source: string) => Promise<FlowchartImportResult>),
  mock: vi.fn<(source: string) => Promise<FlowchartImportResult>>(),
}));

vi.mock('../flowchart-import', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../flowchart-import')>();
  importer.actual = actual.importMermaidFlowchart;
  return {
    ...actual,
    importMermaidFlowchart: importer.mock,
  };
});

const originalClipboard = navigator.clipboard;
const source = 'flowchart LR\n  idea[Idea] --> ship[Ship]';

const canvas: FlowchartCanvasV1 = {
  kind: 'flowchart',
  version: 1,
  direction: 'LR',
  nodes: [
    {
      id: 'idea',
      label: 'Idea',
      shape: 'squareRect',
      position: { x: 40, y: 80 },
    },
    {
      id: 'ship',
      label: 'Ship',
      shape: 'squareRect',
      position: { x: 360, y: 80 },
    },
    {
      id: 'removed',
      label: 'Removed',
      shape: 'squareRect',
      position: { x: 720, y: 240 },
    },
  ],
  edges: [
    {
      id: 'edge|idea|ship|0',
      source: 'idea',
      target: 'ship',
      arrowStart: false,
      arrowEnd: true,
      lineStyle: 'solid',
    },
  ],
};

const reconciledGraph: ImportedFlowchart = {
  direction: 'LR',
  nodes: [
    { id: 'idea', label: 'New idea', shape: 'roundedRect' },
    { id: 'ship', label: 'Ship', shape: 'squareRect' },
    { id: 'added', label: 'Added', shape: 'circle' },
  ],
  edges: [
    {
      id: 'edge|idea|ship|0',
      source: 'idea',
      target: 'ship',
      arrowStart: false,
      arrowEnd: true,
      lineStyle: 'solid',
    },
    {
      id: 'edge|ship|added|0',
      source: 'ship',
      target: 'added',
      arrowStart: false,
      arrowEnd: true,
      lineStyle: 'solid',
    },
  ],
  warnings: [],
};

function compatibleResult(
  graph: ImportedFlowchart = reconciledGraph,
): FlowchartImportResult {
  return { status: 'compatible', graph };
}

function MovingCanvasHarness() {
  const [currentCanvas, setCurrentCanvas] = useState(canvas);
  return (
    <div>
      <MermaidImportPanel
        source={source}
        canvas={currentCanvas}
        onApply={vi.fn()}
      />
      <button
        type="button"
        onClick={() => setCurrentCanvas({
          ...currentCanvas,
          nodes: currentCanvas.nodes.map((node) => (
            node.id === 'idea'
              ? { ...node, position: { x: 999, y: -50 } }
              : node
          )),
        })}
      >
        Move node
      </button>
    </div>
  );
}

async function openEditor(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Edit import' }));
  return screen.getByLabelText('Mermaid source');
}

describe('MermaidImportPanel', () => {
  beforeEach(() => {
    importer.mock.mockReset();
    importer.mock.mockResolvedValue(compatibleResult());
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: originalClipboard,
    });
  });

  it('keeps retained Mermaid read-only when visual node positions move', async () => {
    const user = userEvent.setup();
    render(<MovingCanvasHarness />);

    const retainedSource = screen.getByLabelText('Mermaid source');
    expect(retainedSource).toHaveValue(source);
    expect(retainedSource).toHaveAttribute('readonly');

    await user.click(screen.getByRole('button', { name: 'Move node' }));

    expect(screen.getByLabelText('Mermaid source')).toHaveValue(source);
    expect(screen.getByLabelText('Mermaid source')).toHaveAttribute('readonly');
  });

  it('opens an editable staged copy and Cancel discards it', async () => {
    const user = userEvent.setup();
    render(
      <MermaidImportPanel source={source} canvas={canvas} onApply={vi.fn()} />,
    );

    const stagedSource = await openEditor(user);
    expect(stagedSource).not.toHaveAttribute('readonly');
    expect(stagedSource).toHaveValue(source);
    fireEvent.change(stagedSource, {
      target: { value: 'flowchart LR\n  staged --> discarded' },
    });

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.getByLabelText('Mermaid source')).toHaveValue(source);
    expect(screen.getByLabelText('Mermaid source')).toHaveAttribute('readonly');
    expect(importer.mock).not.toHaveBeenCalled();
  });

  it('waits exactly 220 ms after the latest edit before checking compatibility', async () => {
    vi.useFakeTimers();
    render(
      <MermaidImportPanel source={source} canvas={canvas} onApply={vi.fn()} />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Edit import' }));
    fireEvent.change(screen.getByLabelText('Mermaid source'), {
      target: { value: 'flowchart LR\n  idea --> changed' },
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(219);
    });
    expect(importer.mock).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(importer.mock).toHaveBeenCalledOnce();
    expect(importer.mock).toHaveBeenCalledWith(
      'flowchart LR\n  idea --> changed',
    );
  });

  it('labels invalid Mermaid as a syntax error and keeps Apply disabled', async () => {
    const user = userEvent.setup();
    importer.mock.mockResolvedValue({
      status: 'unsupported',
      reason: 'No diagram type detected matching given configuration',
      code: 'INVALID_SYNTAX',
    });
    render(
      <MermaidImportPanel source={source} canvas={canvas} onApply={vi.fn()} />,
    );

    const stagedSource = await openEditor(user);
    fireEvent.change(stagedSource, {
      target: { value: 'flowchart LR\n  idea --> broken[' },
    });

    expect(
      await screen.findByRole('alert', {}, { timeout: 1000 }),
    ).toHaveTextContent('Mermaid syntax error');
    expect(screen.getByRole('alert')).toHaveTextContent(
      'No diagram type detected matching given configuration',
    );
    expect(screen.getByRole('button', { name: 'Apply import' })).toBeDisabled();
  });

  it('shows an unsupported compatibility reason and keeps Apply disabled', async () => {
    const user = userEvent.setup();
    importer.mock.mockResolvedValue({
      status: 'unsupported',
      reason: 'Only Mermaid flowcharts support interactive mode.',
    });
    render(
      <MermaidImportPanel source={source} canvas={canvas} onApply={vi.fn()} />,
    );

    const stagedSource = await openEditor(user);
    fireEvent.change(stagedSource, {
      target: { value: 'sequenceDiagram\n  Alice->>Bob: Hello' },
    });

    expect(
      await screen.findByRole('alert', {}, { timeout: 1000 }),
    ).toHaveTextContent('Not compatible');
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Only Mermaid flowcharts support interactive mode.',
    );
    expect(screen.getByRole('button', { name: 'Apply import' })).toBeDisabled();
  });

  it.each([
    ['empty input', '', 'Mermaid syntax error'],
    ['nonsense input', 'this is not Mermaid', 'Mermaid syntax error'],
    [
      'a sequence diagram',
      'sequenceDiagram\n  Alice->>Bob: Hello',
      'Not compatible',
    ],
    [
      'a subgraph flowchart',
      'flowchart LR\n  subgraph Group\n    A --> B\n  end',
      'Not compatible',
    ],
  ])('classifies real Mermaid compatibility for %s', async (
    _caseName,
    staged,
    expectedHeading,
  ) => {
    const user = userEvent.setup();
    importer.mock.mockImplementation((stagedSource) => {
      if (!importer.actual) {
        throw new Error('Expected the real Mermaid importer.');
      }
      return importer.actual(stagedSource);
    });
    render(
      <MermaidImportPanel source={source} canvas={canvas} onApply={vi.fn()} />,
    );

    const stagedSource = await openEditor(user);
    fireEvent.change(stagedSource, { target: { value: staged } });

    expect(
      await screen.findByRole('alert', {}, { timeout: 5000 }),
    ).toHaveTextContent(expectedHeading);
    expect(screen.getByRole('button', { name: 'Apply import' })).toBeDisabled();
  });

  it('reports the exact reconciliation counts for compatible Mermaid', async () => {
    const user = userEvent.setup();
    render(
      <MermaidImportPanel source={source} canvas={canvas} onApply={vi.fn()} />,
    );

    await openEditor(user);

    const summary = await screen.findByRole(
      'status',
      { name: 'Import reconciliation' },
      { timeout: 1000 },
    );
    expect(summary).toHaveTextContent('1 added');
    expect(summary).toHaveTextContent('1 removed');
    expect(summary).toHaveTextContent('2 preserved');
    expect(screen.getByRole('button', { name: 'Apply import' })).toBeEnabled();
  });

  it('rejects a real compatible import whose reconciled canvas fails shared schema validation', async () => {
    const user = userEvent.setup();
    const onApply = vi.fn();
    const oversizedSource =
      `flowchart LR\n  idea["${'x'.repeat(20_001)}"] --> ship`;
    importer.mock.mockImplementation((stagedSource) => {
      if (!importer.actual) {
        throw new Error('Expected the real Mermaid importer.');
      }
      return importer.actual(stagedSource);
    });
    render(
      <MermaidImportPanel
        source={source}
        canvas={canvas}
        onApply={onApply}
      />,
    );

    const stagedSource = await openEditor(user);
    fireEvent.change(stagedSource, {
      target: { value: oversizedSource },
    });

    expect(
      await screen.findByRole('alert', {}, { timeout: 5000 }),
    ).toHaveTextContent('could not be validated safely');
    const apply = screen.getByRole('button', { name: 'Apply import' });
    expect(apply).toBeDisabled();
    await user.click(apply);
    expect(onApply).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByLabelText('Mermaid source')).toHaveValue(source);
  });

  it('moves focus into staged editing and returns it to Edit import after Cancel and Apply', async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(
      <MermaidImportPanel source={source} canvas={canvas} onApply={vi.fn()} />,
    );

    const firstStagedSource = await openEditor(user);
    expect(firstStagedSource).toHaveFocus();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('button', { name: 'Edit import' })).toHaveFocus();

    const secondStagedSource = await openEditor(user);
    expect(secondStagedSource).toHaveFocus();
    await waitFor(
      () =>
        expect(screen.getByRole('button', { name: 'Apply import' }))
          .toBeEnabled(),
      { timeout: 1000 },
    );
    await user.click(screen.getByRole('button', { name: 'Apply import' }));
    expect(confirm).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: 'Edit import' })).toHaveFocus();
  });

  it('confirms an exact destructive summary and applies the staged source and reconciled canvas once', async () => {
    const user = userEvent.setup();
    const onApply = vi.fn();
    const confirm = vi.spyOn(window, 'confirm')
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);
    render(
      <MermaidImportPanel source={source} canvas={canvas} onApply={onApply} />,
    );
    const staged = 'flowchart LR\n  idea(New idea) --> ship --> added((Added))';

    const stagedSource = await openEditor(user);
    fireEvent.change(stagedSource, { target: { value: staged } });
    const apply = await screen.findByRole(
      'button',
      { name: 'Apply import' },
      { timeout: 1000 },
    );
    await waitFor(() => expect(apply).toBeEnabled());

    await user.click(apply);
    expect(confirm).toHaveBeenLastCalledWith(
      'This import removes 1 node(s) from the visual canvas. Apply it?',
    );
    expect(onApply).not.toHaveBeenCalled();

    await user.click(apply);
    expect(onApply).toHaveBeenCalledOnce();
    const applied = onApply.mock.calls[0]?.[0];
    expect(applied).toMatchObject({
      source: staged,
      summary: { added: 1, removed: 1, preserved: 2 },
      canvas: {
        kind: 'flowchart',
        version: 1,
        direction: 'LR',
        nodes: [
          {
            id: 'idea',
            label: 'New idea',
            shape: 'roundedRect',
            position: { x: 40, y: 80 },
          },
          {
            id: 'ship',
            label: 'Ship',
            shape: 'squareRect',
            position: { x: 360, y: 80 },
          },
          expect.objectContaining({
            id: 'added',
            label: 'Added',
            shape: 'circle',
          }),
        ],
      },
    });
  });

  it('copies the complete displayed Mermaid and reports success or failure', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('Clipboard denied'));
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    render(
      <MermaidImportPanel source={source} canvas={canvas} onApply={vi.fn()} />,
    );

    await user.click(screen.getByRole('button', { name: 'Copy Mermaid' }));
    expect(writeText).toHaveBeenLastCalledWith(source);
    expect(await screen.findByRole('status')).toHaveTextContent('Copied');

    await user.click(screen.getByRole('button', { name: 'Copy Mermaid' }));
    expect(writeText).toHaveBeenLastCalledWith(source);
    expect(await screen.findByRole('status')).toHaveTextContent('Copy failed');
  });

  it.each([
    ['Edit import', 'button'],
    ['Copy Mermaid', 'button'],
    ['Mermaid source', 'textarea'],
  ])('stops pointer down on the %s control before it can pan', (name, kind) => {
    const pan = vi.fn();
    render(
      <div onPointerDown={pan}>
        <MermaidImportPanel
          source={source}
          canvas={canvas}
          onApply={vi.fn()}
        />
      </div>,
    );
    const control = kind === 'button'
      ? screen.getByRole('button', { name })
      : screen.getByLabelText(name);

    fireEvent.pointerDown(control);

    expect(pan).not.toHaveBeenCalled();
  });
});
