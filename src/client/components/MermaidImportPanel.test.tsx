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

const importer = vi.hoisted(() => vi.fn<
  (source: string) => Promise<FlowchartImportResult>
>());

vi.mock('../flowchart-import', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../flowchart-import')>();
  return {
    ...actual,
    importMermaidFlowchart: importer,
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
    importer.mockReset();
    importer.mockResolvedValue(compatibleResult());
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
    expect(importer).not.toHaveBeenCalled();
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
    expect(importer).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(importer).toHaveBeenCalledOnce();
    expect(importer).toHaveBeenCalledWith(
      'flowchart LR\n  idea --> changed',
    );
  });

  it('labels invalid Mermaid as a syntax error and keeps Apply disabled', async () => {
    const user = userEvent.setup();
    importer.mockResolvedValue({
      status: 'unsupported',
      reason: 'Parse error on line 2',
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
      'Parse error on line 2',
    );
    expect(screen.getByRole('button', { name: 'Apply import' })).toBeDisabled();
  });

  it('shows an unsupported compatibility reason and keeps Apply disabled', async () => {
    const user = userEvent.setup();
    importer.mockResolvedValue({
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

  it('reports the exact reconciliation counts for compatible Mermaid', async () => {
    const user = userEvent.setup();
    render(
      <MermaidImportPanel source={source} canvas={canvas} onApply={vi.fn()} />,
    );

    await openEditor(user);

    expect(await screen.findByText('1 added', {}, { timeout: 1000 }))
      .toBeInTheDocument();
    expect(screen.getByText('1 removed')).toBeInTheDocument();
    expect(screen.getByText('2 preserved')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Apply import' })).toBeEnabled();
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
