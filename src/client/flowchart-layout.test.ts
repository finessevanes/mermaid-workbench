import { describe, expect, it } from 'vitest';
import type { ImportedFlowchart } from './flowchart-import';
import {
  flowchartNodeSize,
  layoutImportedFlowchart,
  reconcileFlowchartImport,
} from './flowchart-layout';
import type { FlowchartCanvasV1, FlowchartDirection } from '../shared/flowchart-canvas-schema';

function importedGraph(direction: FlowchartDirection): ImportedFlowchart {
  return {
    direction,
    nodes: [
      { id: 'source', label: 'Source', shape: 'squareRect' },
      { id: 'decision', label: 'Choose a direction', shape: 'diamond' },
      { id: 'target', label: 'Target', shape: 'circle' },
    ],
    edges: [
      {
        id: 'edge|source|decision|0',
        source: 'source',
        target: 'decision',
        arrowStart: false,
        arrowEnd: true,
        lineStyle: 'solid',
      },
      {
        id: 'edge|decision|target|0',
        source: 'decision',
        target: 'target',
        arrowStart: false,
        arrowEnd: true,
        lineStyle: 'solid',
      },
    ],
    warnings: [],
  };
}

function nodeById(canvas: FlowchartCanvasV1, id: string) {
  const node = canvas.nodes.find((candidate) => candidate.id === id);
  expect(node).toBeDefined();
  return node!;
}

function center(node: FlowchartCanvasV1['nodes'][number]) {
  const { width, height } = flowchartNodeSize(node.shape, node.label);
  return { x: node.position.x + width / 2, y: node.position.y + height / 2 };
}

function expectNoOverlaps(canvas: FlowchartCanvasV1) {
  for (let index = 0; index < canvas.nodes.length; index += 1) {
    const first = canvas.nodes[index]!;
    const firstSize = flowchartNodeSize(first.shape, first.label);

    for (let otherIndex = index + 1; otherIndex < canvas.nodes.length; otherIndex += 1) {
      const second = canvas.nodes[otherIndex]!;
      const secondSize = flowchartNodeSize(second.shape, second.label);
      const overlaps =
        first.position.x < second.position.x + secondSize.width &&
        first.position.x + firstSize.width > second.position.x &&
        first.position.y < second.position.y + secondSize.height &&
        first.position.y + firstSize.height > second.position.y;

      expect(overlaps, `${first.id} overlaps ${second.id}`).toBe(false);
    }
  }
}

describe('flowchartNodeSize', () => {
  it.each([
    ['squareRect', '', { width: 120, height: 72 }],
    ['squareRect', 'A label that is deliberately long enough to be capped', { width: 260, height: 72 }],
    ['circle', 'Short', { width: 120, height: 120 }],
    ['doublecircle', 'A label that is deliberately long enough to be capped', { width: 260, height: 160 }],
  ])('sizes %s nodes from their labels', (shape, label, expected) => {
    expect(flowchartNodeSize(shape, label)).toEqual(expected);
  });
});

describe('layoutImportedFlowchart', () => {
  it.each(['LR', 'TB', 'BT', 'RL'] as const)(
    'returns finite non-overlapping coordinates for %s graphs',
    (direction) => {
      const graph = importedGraph(direction);
      const before = structuredClone(graph);

      const canvas = layoutImportedFlowchart(graph);

      expect(canvas.nodes).toHaveLength(3);
      expect(canvas.nodes.every(({ position }) => Number.isFinite(position.x) && Number.isFinite(position.y))).toBe(true);
      expectNoOverlaps(canvas);
      expect(graph).toEqual(before);
    },
  );

  it('places LR targets to the right of their sources', () => {
    const canvas = layoutImportedFlowchart(importedGraph('LR'));

    expect(center(nodeById(canvas, 'target')).x).toBeGreaterThan(
      center(nodeById(canvas, 'source')).x,
    );
  });

  it('places TB targets below their sources', () => {
    const canvas = layoutImportedFlowchart(importedGraph('TB'));

    expect(center(nodeById(canvas, 'target')).y).toBeGreaterThan(
      center(nodeById(canvas, 'source')).y,
    );
  });

  it('returns deterministic top-left positions', () => {
    const graph = importedGraph('LR');

    expect(layoutImportedFlowchart(graph)).toEqual(layoutImportedFlowchart(graph));
  });
});

describe('reconcileFlowchartImport', () => {
  it('preserves surviving positions while replacing imported node and edge data', () => {
    const previous = {
      kind: 'flowchart',
      version: 1,
      direction: 'LR',
      nodes: [
        { id: 'a', label: 'Original A', shape: 'squareRect', position: { x: 17, y: 29 } },
        { id: 'b', label: 'Original B', shape: 'diamond', position: { x: 311, y: 419 } },
        { id: 'removed', label: 'Removed', shape: 'circle', position: { x: 701, y: 809 } },
      ],
      edges: [
        {
          id: 'edge|a|removed|0',
          source: 'a',
          target: 'removed',
          arrowStart: false,
          arrowEnd: true,
          lineStyle: 'solid',
        },
      ],
    } satisfies FlowchartCanvasV1;
    const graph: ImportedFlowchart = {
      direction: 'TB',
      nodes: [
        { id: 'a', label: 'Original A', shape: 'squareRect' },
        { id: 'b', label: 'Renamed B', shape: 'doublecircle' },
        { id: 'c', label: 'New C', shape: 'stadium' },
      ],
      edges: [
        {
          id: 'edge|a|b|0',
          source: 'a',
          target: 'b',
          label: 'renamed',
          arrowStart: false,
          arrowEnd: true,
          lineStyle: 'dotted',
        },
        {
          id: 'edge|b|c|0',
          source: 'b',
          target: 'c',
          arrowStart: true,
          arrowEnd: false,
          lineStyle: 'thick',
        },
      ],
      warnings: [],
    };
    const previousBefore = structuredClone(previous);
    const graphBefore = structuredClone(graph);

    const { canvas, summary } = reconcileFlowchartImport(previous, graph);

    expect(nodeById(canvas, 'a').position).toEqual({ x: 17, y: 29 });
    expect(nodeById(canvas, 'b')).toMatchObject({
      label: 'Renamed B',
      shape: 'doublecircle',
      position: { x: 311, y: 419 },
    });
    expect(canvas.nodes.find((node) => node.id === 'removed')).toBeUndefined();
    expect(nodeById(canvas, 'c').position).toSatisfy(
      ({ x, y }: { x: number; y: number }) => Number.isFinite(x) && Number.isFinite(y),
    );
    expect(summary).toEqual({ added: 1, removed: 1, preserved: 2 });
    expect(canvas.edges).toEqual(graph.edges);
    expect(previous).toEqual(previousBefore);
    expect(graph).toEqual(graphBefore);
  });
});
