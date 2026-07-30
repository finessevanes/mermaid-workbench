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
  internalNodes: new Map<string, {
    id: string;
    data: { label: string; shape: string };
    measured: { width: number; height: number };
    internals: { positionAbsolute: { x: number; y: number } };
  }>(),
}));

vi.mock('@xyflow/react', () => ({
  ReactFlow: (props: {
    nodes: Array<{
      id: string;
      data: { label: string; shape: string };
      position: { x: number; y: number };
      style?: { width?: number; height?: number };
    }>;
    edges: Array<{
      id: string;
      source: string;
      target: string;
      data?: Record<string, unknown>;
      markerStart?: unknown;
      markerEnd?: unknown;
    }>;
    nodeTypes: Record<string, React.ComponentType<any>>;
    edgeTypes: Record<string, React.ComponentType<any>>;
    disableKeyboardA11y?: boolean;
    onMove: (event: unknown, viewport: { zoom: number }) => void;
    onNodeDragStop: () => void;
    onNodesChange: (changes: unknown[]) => void;
  }) => {
    reactFlow.internalNodes.clear();
    props.nodes.forEach((node) => {
      reactFlow.internalNodes.set(node.id, {
        id: node.id,
        data: node.data,
        measured: {
          width: node.style?.width ?? 120,
          height: node.style?.height ?? 72,
        },
        internals: { positionAbsolute: node.position },
      });
    });
    const NodeComponent = props.nodeTypes.flowchart;
    const EdgeComponent = props.edgeTypes.floatingFlowchart;
    return (
      <div data-testid="react-flow">
        <output data-testid="keyboard-a11y-disabled">{String(props.disableKeyboardA11y)}</output>
        <svg>
          {props.edges.map((edge) => (
            <EdgeComponent
              key={edge.id}
              id={edge.id}
              source={edge.source}
              target={edge.target}
              data={edge.data}
              markerStart={edge.markerStart ? 'url(#arrowclosed)' : undefined}
              markerEnd={edge.markerEnd ? 'url(#arrowclosed)' : undefined}
              sourceX={0}
              sourceY={0}
              targetX={0}
              targetY={0}
              sourcePosition="right"
              targetPosition="left"
            />
          ))}
        </svg>
        {props.nodes.map((node) => (
          <NodeComponent
            key={node.id}
            id={node.id}
            data={node.data}
            selected={false}
          />
        ))}
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
    );
  },
  BaseEdge: (props: { id: string; path: string; className?: string; markerStart?: string; markerEnd?: string }) => (
    <path
      data-testid={`edge-${props.id}`}
      className={props.className}
      d={props.path}
      markerStart={props.markerStart}
      markerEnd={props.markerEnd}
    />
  ),
  EdgeLabelRenderer: ({ children }: PropsWithChildren) => <>{children}</>,
  getBezierPath: ({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  }: {
    sourceX: number;
    sourceY: number;
    sourcePosition: string;
    targetX: number;
    targetY: number;
    targetPosition: string;
  }) => [
    `M ${sourceX} ${sourceY} ${sourcePosition} L ${targetX} ${targetY} ${targetPosition}`,
    (sourceX + targetX) / 2,
    (sourceY + targetY) / 2,
  ],
  Handle: () => null,
  Position: { Bottom: 'bottom', Left: 'left', Right: 'right', Top: 'top' },
  MarkerType: { ArrowClosed: 'arrowclosed' },
  ReactFlowProvider: ({ children }: PropsWithChildren) => <>{children}</>,
  useReactFlow: () => reactFlow,
  useInternalNode: (id: string) => reactFlow.internalNodes.get(id),
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
    expect(screen.getByTestId('keyboard-a11y-disabled')).toHaveTextContent('true');
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

  it('reroutes a rendered edge and preserves its label as a connected node moves', async () => {
    const user = userEvent.setup();
    const labelledCanvas: FlowchartCanvasV1 = {
      ...canvas,
      edges: [{ ...canvas.edges[0], label: 'ships' }],
    };
    function LabelledHarness() {
      const [currentCanvas, setCurrentCanvas] = useState(labelledCanvas);
      return (
        <FlowchartCanvas
          canvas={currentCanvas}
          onCanvasChange={setCurrentCanvas}
          onCommit={vi.fn()}
          onResetLayout={vi.fn()}
        />
      );
    }
    render(<LabelledHarness />);

    const edge = screen.getByTestId('edge-idea-ship-0');
    const initialPath = edge.getAttribute('d');
    expect(screen.getByText('ships')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Move idea node' }));

    expect(edge).not.toHaveAttribute('d', initialPath);
    expect(screen.getByText('ships')).toBeInTheDocument();
  });

  it('changes an edge attachment from right-to-left to left-to-right when a node crosses its neighbor', async () => {
    const user = userEvent.setup();
    render(
      <CanvasHarness
        onCanvasChange={vi.fn()}
        onCommit={vi.fn()}
        onResetLayout={vi.fn()}
      />,
    );

    expect(screen.getByTestId('edge-idea-ship-0')).toHaveAttribute(
      'd',
      expect.stringContaining('right'),
    );

    await user.click(screen.getByRole('button', { name: 'Move idea node' }));

    expect(screen.getByTestId('edge-idea-ship-0')).toHaveAttribute(
      'd',
      expect.stringContaining('left'),
    );
  });

  it('maps edge markers and line styles into the rendered edge without dropping its label', () => {
    const metadataCanvas: FlowchartCanvasV1 = {
      ...canvas,
      edges: [
        { ...canvas.edges[0], id: 'dotted', lineStyle: 'dotted', arrowStart: true, label: 'dotted' },
        { ...canvas.edges[0], id: 'thick', lineStyle: 'thick', arrowEnd: false, label: 'thick' },
        { ...canvas.edges[0], id: 'invisible', lineStyle: 'invisible', arrowEnd: false, label: 'invisible' },
      ],
    };
    render(
      <FlowchartCanvas
        canvas={metadataCanvas}
        onCanvasChange={vi.fn()}
        onCommit={vi.fn()}
        onResetLayout={vi.fn()}
      />,
    );

    expect(screen.getByTestId('edge-dotted')).toHaveClass('flowchart-edge--dotted');
    expect(screen.getByTestId('edge-dotted')).toHaveAttribute('marker-start');
    expect(screen.getByTestId('edge-thick')).toHaveClass('flowchart-edge--thick');
    expect(screen.getByTestId('edge-thick')).not.toHaveAttribute('marker-end');
    expect(screen.getByTestId('edge-invisible')).toHaveClass('flowchart-edge--invisible');
    expect(screen.getByText('dotted')).toBeInTheDocument();
    expect(screen.getByText('thick')).toBeInTheDocument();
    expect(screen.getByText('invisible')).toBeInTheDocument();
  });

  it('nudges a focused node by one pixel and commits one copied canvas without changing topology', async () => {
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

    const idea = screen.getByLabelText('Idea');
    idea.focus();
    await user.keyboard('{ArrowRight}');

    expect(onCanvasChange).toHaveBeenCalledOnce();
    expect(onCommit).toHaveBeenCalledOnce();
    const nextCanvas = onCommit.mock.calls[0][0] as FlowchartCanvasV1;
    expect(nextCanvas).not.toBe(canvas);
    expect(nextCanvas.nodes).toEqual([
      expect.objectContaining({ id: 'idea', position: { x: 41, y: 80 } }),
      canvas.nodes[1],
    ]);
    expect(nextCanvas.edges).toEqual(canvas.edges);
  });

  it('nudges a focused node ten pixels with Shift+Arrow and leaves unrelated keys alone', async () => {
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

    const idea = screen.getByLabelText('Idea');
    idea.focus();
    await user.keyboard('{Shift>}{ArrowDown}{/Shift}');
    await user.keyboard('{Alt>}{ArrowLeft}{/Alt}');
    await user.keyboard('{Control>}{ArrowUp}{/Control}');
    await user.keyboard('{Meta>}{ArrowRight}{/Meta}');
    await user.keyboard('a');

    expect(onCanvasChange).toHaveBeenCalledOnce();
    expect(onCommit).toHaveBeenCalledOnce();
    expect(onCommit).toHaveBeenLastCalledWith(expect.objectContaining({
      nodes: expect.arrayContaining([
        expect.objectContaining({ id: 'idea', position: { x: 40, y: 90 } }),
      ]),
      edges: canvas.edges,
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
