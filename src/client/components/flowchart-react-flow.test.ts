import type { NodeChange } from '@xyflow/react';
import { describe, expect, it } from 'vitest';
import type { FlowchartCanvasV1 } from '../../shared/flowchart-canvas-schema';
import {
  applyReactFlowNodeChanges,
  toReactFlowNodes,
} from './flowchart-react-flow';

const canvas: FlowchartCanvasV1 = {
  kind: 'flowchart',
  version: 1,
  direction: 'LR',
  nodes: [
    {
      id: 'idea',
      label: 'Idea',
      shape: 'rect',
      position: { x: 40, y: 80 },
    },
    {
      id: 'ship',
      label: 'Ship',
      shape: 'circle',
      position: { x: 340, y: 80 },
    },
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

describe('toReactFlowNodes', () => {
  it('preserves each canvas node ID, label, shape, and position', () => {
    expect(toReactFlowNodes(canvas)).toEqual([
      expect.objectContaining({
        id: 'idea',
        type: 'flowchart',
        position: { x: 40, y: 80 },
        data: { label: 'Idea', shape: 'rect' },
        deletable: false,
        connectable: false,
      }),
      expect.objectContaining({
        id: 'ship',
        type: 'flowchart',
        position: { x: 340, y: 80 },
        data: { label: 'Ship', shape: 'circle' },
        deletable: false,
        connectable: false,
      }),
    ]);
  });
});

describe('applyReactFlowNodeChanges', () => {
  it('immutably applies position changes to their matching canvas node only', () => {
    const result = applyReactFlowNodeChanges(canvas, [
      {
        id: 'idea',
        type: 'position',
        position: { x: 210, y: 130 },
        dragging: true,
      },
    ]);

    expect(result).toEqual({
      ...canvas,
      nodes: [
        { ...canvas.nodes[0], position: { x: 210, y: 130 } },
        canvas.nodes[1],
      ],
    });
    expect(result).not.toBe(canvas);
    expect(result.nodes).not.toBe(canvas.nodes);
    expect(result.nodes[0]).not.toBe(canvas.nodes[0]);
    expect(canvas.nodes[0].position).toEqual({ x: 40, y: 80 });
  });

  it('ignores topology and presentation changes so React Flow cannot alter V1 topology', () => {
    const topologyChanges: NodeChange[] = [
      { id: 'idea', type: 'remove' },
      {
        item: {
          id: 'new-node',
          type: 'flowchart',
          position: { x: 0, y: 0 },
          data: { label: 'New', shape: 'rect' },
        },
        type: 'add',
      },
      {
        id: 'idea',
        type: 'replace',
        item: {
          id: 'idea',
          type: 'flowchart',
          position: { x: 0, y: 0 },
          data: { label: 'Changed', shape: 'circle' },
        },
      },
      { id: 'idea', type: 'dimensions', dimensions: { width: 100, height: 80 } },
      { id: 'idea', type: 'select', selected: true },
    ];

    expect(applyReactFlowNodeChanges(canvas, topologyChanges)).toBe(canvas);
  });
});
