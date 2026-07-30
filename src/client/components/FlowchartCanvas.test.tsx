// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState, type PropsWithChildren } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { FlowchartCanvasV1 } from '../../shared/flowchart-canvas-schema';
import { FlowchartCanvas } from './FlowchartCanvas';

const reactFlow = vi.hoisted(() => ({
  fitView: vi.fn(),
  setViewport: vi.fn(),
  zoomTo: vi.fn(),
}));

vi.mock('@xyflow/react', () => ({
  ReactFlow: (props: {
    nodes: Array<{ id: string; position: { x: number; y: number } }>;
    onMove: (event: unknown, viewport: { zoom: number }) => void;
    onNodeDragStop: () => void;
    onNodesChange: (changes: unknown[]) => void;
  }) => (
    <div data-testid="react-flow">
      <button
        type="button"
        aria-label="Move idea node"
        onClick={() => props.onNodesChange([
          {
            id: 'idea',
            type: 'position',
            position: { x: 210, y: 130 },
            dragging: true,
          },
        ])}
      >
        Move idea
      </button>
      <button
        type="button"
        aria-label="Finish idea drag"
        onClick={() => props.onNodeDragStop()}
      >
        Finish drag
      </button>
      <button
        type="button"
        aria-label="Pan flowchart pane"
        onClick={() => props.onMove(null, { zoom: 1 })}
      >
        Pan pane
      </button>
    </div>
  ),
  Handle: () => null,
  Position: { Bottom: 'bottom', Top: 'top' },
  ReactFlowProvider: ({ children }: PropsWithChildren) => <>{children}</>,
  useReactFlow: () => reactFlow,
}));

const canvas: FlowchartCanvasV1 = {
  kind: 'flowchart',
  version: 1,
  direction: 'LR',
  nodes: [
    { id: 'idea', label: 'Idea', shape: 'rect', position: { x: 40, y: 80 } },
    { id: 'ship', label: 'Ship', shape: 'circle', position: { x: 340, y: 80 } },
  ],
  edges: [
    {
      id: 'idea-ship-0',
      source: 'idea',
      target: 'ship',
      arrowStart: false,
      arrowEnd: true,
      lineStyle: 'solid',
    },
  ],
};

function CanvasHarness({
  onCanvasChange,
  onCommit,
  onResetLayout,
}: {
  onCanvasChange: (next: FlowchartCanvasV1) => void;
  onCommit: (next: FlowchartCanvasV1) => void;
  onResetLayout: () => void;
}) {
  const [currentCanvas, setCurrentCanvas] = useState(canvas);
  return (
    <FlowchartCanvas
      canvas={currentCanvas}
      onCanvasChange={(next) => {
        onCanvasChange(next);
        setCurrentCanvas(next);
      }}
      onCommit={onCommit}
      onResetLayout={onResetLayout}
    />
  );
}

describe('FlowchartCanvas', () => {
  it('exposes the interactive canvas region and viewport controls', () => {
    render(
      <CanvasHarness
        onCanvasChange={vi.fn()}
        onCommit={vi.fn()}
        onResetLayout={vi.fn()}
      />,
    );

    expect(screen.getByRole('region', { name: 'Interactive flowchart' }))
      .toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Zoom out' })).toBeEnabled();
    expect(screen.getByRole('status', { name: 'Zoom level' }))
      .toHaveTextContent('100%');
    expect(screen.getByRole('button', { name: 'Zoom in' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Fit diagram' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '100%' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Reset layout' })).toBeEnabled();
  });

  it('clamps zoom controls to the inclusive 10% and 400% bounds', async () => {
    const user = userEvent.setup();
    render(
      <CanvasHarness
        onCanvasChange={vi.fn()}
        onCommit={vi.fn()}
        onResetLayout={vi.fn()}
      />,
    );

    const zoomOut = screen.getByRole('button', { name: 'Zoom out' });
    const zoomIn = screen.getByRole('button', { name: 'Zoom in' });

    for (let index = 0; index < 9; index += 1) {
      await user.click(zoomOut);
    }
    expect(screen.getByRole('status', { name: 'Zoom level' }))
      .toHaveTextContent('10%');
    expect(zoomOut).toBeDisabled();

    for (let index = 0; index < 39; index += 1) {
      await user.click(zoomIn);
    }
    expect(screen.getByRole('status', { name: 'Zoom level' }))
      .toHaveTextContent('400%');
    expect(zoomIn).toBeDisabled();
  });

  it('updates coordinates during a node drag and commits the latest canvas once when it stops', async () => {
    const user = userEvent.setup();
    const onCanvasChange = vi.fn();
    const onCommit = vi.fn();
    render(
      <CanvasHarness
        onCanvasChange={onCanvasChange}
        onCommit={onCommit}
        onResetLayout={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Move idea node' }));
    expect(onCanvasChange).toHaveBeenCalledOnce();
    expect(onCanvasChange).toHaveBeenLastCalledWith(expect.objectContaining({
      nodes: [
        expect.objectContaining({ id: 'idea', position: { x: 210, y: 130 } }),
        expect.objectContaining({ id: 'ship', position: { x: 340, y: 80 } }),
      ],
    }));

    await user.click(screen.getByRole('button', { name: 'Finish idea drag' }));
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenLastCalledWith(expect.objectContaining({
      nodes: expect.arrayContaining([
        expect.objectContaining({ id: 'idea', position: { x: 210, y: 130 } }),
      ]),
    }));
  });

  it('keeps pane movement outside the canvas change and commit paths', async () => {
    const user = userEvent.setup();
    const onCanvasChange = vi.fn();
    const onCommit = vi.fn();
    render(
      <CanvasHarness
        onCanvasChange={onCanvasChange}
        onCommit={onCommit}
        onResetLayout={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Pan flowchart pane' }));
    expect(onCanvasChange).not.toHaveBeenCalled();
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('delegates reset layout to the editor owner', async () => {
    const user = userEvent.setup();
    const onResetLayout = vi.fn();
    render(
      <CanvasHarness
        onCanvasChange={vi.fn()}
        onCommit={vi.fn()}
        onResetLayout={onResetLayout}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Reset layout' }));
    expect(onResetLayout).toHaveBeenCalledOnce();
  });
});
