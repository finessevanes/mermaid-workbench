import type { Edge, Node, NodeChange } from '@xyflow/react';
import type { FlowchartCanvasV1 } from '../../shared/flowchart-canvas-schema';
import { flowchartNodeSize } from '../flowchart-layout';

export interface FlowchartNodeData extends Record<string, unknown> {
  label: string;
  shape: string;
}

export type FlowchartReactFlowNode = Node<FlowchartNodeData, 'flowchart'>;

export function toReactFlowNodes(
  canvas: FlowchartCanvasV1,
): FlowchartReactFlowNode[] {
  return canvas.nodes.map((node) => {
    const size = flowchartNodeSize(node.shape, node.label);
    return {
      id: node.id,
      type: 'flowchart',
      position: { ...node.position },
      data: { label: node.label, shape: node.shape },
      deletable: false,
      connectable: false,
      style: size,
    };
  });
}

export function toReactFlowEdges(canvas: FlowchartCanvasV1): Edge[] {
  return canvas.edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    label: edge.label,
    deletable: false,
    reconnectable: false,
    hidden: edge.lineStyle === 'invisible',
    style: {
      strokeDasharray: edge.lineStyle === 'dotted' ? '4 4' : undefined,
      strokeWidth: edge.lineStyle === 'thick' ? 3 : undefined,
    },
  }));
}

export function applyReactFlowNodeChanges(
  canvas: FlowchartCanvasV1,
  changes: NodeChange[],
): FlowchartCanvasV1 {
  const positions = new Map<string, { x: number; y: number }>();

  for (const change of changes) {
    if (
      change.type === 'position' &&
      change.position &&
      Number.isFinite(change.position.x) &&
      Number.isFinite(change.position.y)
    ) {
      positions.set(change.id, {
        x: change.position.x,
        y: change.position.y,
      });
    }
  }

  if (positions.size === 0) {
    return canvas;
  }

  let changed = false;
  const nodes = canvas.nodes.map((node) => {
    const position = positions.get(node.id);
    if (!position || (node.position.x === position.x && node.position.y === position.y)) {
      return node;
    }
    changed = true;
    return { ...node, position };
  });

  return changed ? { ...canvas, nodes } : canvas;
}
