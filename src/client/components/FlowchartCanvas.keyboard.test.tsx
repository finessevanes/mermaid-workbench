// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { ReactFlow, ReactFlowProvider, type NodeChange } from '@xyflow/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FlowchartNode } from './FlowchartNode';
import type { FlowchartReactFlowNode } from './flowchart-react-flow';

class TestResizeObserver implements ResizeObserver {
  constructor(_callback: ResizeObserverCallback) {}

  disconnect() {}
  observe() {}
  unobserve() {}
}

const selectedNode: FlowchartReactFlowNode = {
  id: 'idea',
  type: 'flowchart',
  position: { x: 40, y: 80 },
  selected: true,
  data: { label: 'Idea', shape: 'rect' },
};

describe('FlowchartCanvas keyboard interaction boundary', () => {
  const originalResizeObserver = globalThis.ResizeObserver;

  beforeEach(() => {
    globalThis.ResizeObserver = TestResizeObserver;
  });

  afterEach(() => {
    globalThis.ResizeObserver = originalResizeObserver;
  });

  it('does not let React Flow move a selected custom node for custom or modified arrow keys', () => {
    const onNodeChanges = vi.fn<(changes: NodeChange[]) => void>();
    const onNudge = vi.fn();
    render(
      <div style={{ height: 600, width: 900 }}>
        <ReactFlowProvider>
          <ReactFlow
            nodes={[{
              ...selectedNode,
              data: { ...selectedNode.data, onNudge },
            }]}
            edges={[]}
            nodeTypes={{ flowchart: FlowchartNode }}
            nodesDraggable
            nodesFocusable
            disableKeyboardA11y
            onNodesChange={onNodeChanges}
          />
        </ReactFlowProvider>
      </div>,
    );

    const idea = screen.getByLabelText('Idea');
    fireEvent.keyDown(idea, { key: 'ArrowRight' });
    fireEvent.keyDown(idea, { key: 'ArrowDown', shiftKey: true });
    fireEvent.keyDown(idea, { key: 'ArrowLeft', altKey: true });
    fireEvent.keyDown(idea, { key: 'ArrowUp', ctrlKey: true });
    fireEvent.keyDown(idea, { key: 'ArrowRight', metaKey: true });

    expect(onNudge).toHaveBeenCalledTimes(5);
    expect(onNodeChanges).not.toHaveBeenCalled();
  });
});
