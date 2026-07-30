import { MarkerType, type Edge, type Node, type NodeChange } from '@xyflow/react';
import type { KeyboardEvent } from 'react';
import type { FlowchartCanvasV1 } from '../../shared/flowchart-canvas-schema';
import { flowchartNodeSize } from '../flowchart-layout';
import type { FloatingFlowchartEdgeData } from './FloatingFlowchartEdge';

export interface FlowchartNodeData extends Record<string, unknown> {
  label: string;
  shape: string;
  onNudge?: (id: string, event: KeyboardEvent<HTMLDivElement>) => void;
}

export type FlowchartReactFlowNode = Node<FlowchartNodeData, 'flowchart'>;

export function toReactFlowNodes(
  canvas: FlowchartCanvasV1,
  onNudge?: FlowchartNodeData['onNudge'],
): FlowchartReactFlowNode[] {
  return canvas.nodes.map((node) => {
    const size = flowchartNodeSize(node.shape, node.label);
    return {
      id: node.id,
      type: 'flowchart',
      position: { ...node.position },
      data: { label: node.label, shape: node.shape, onNudge },
      deletable: false,
      connectable: false,
      style: size,
    };
  });
}

export function toReactFlowEdges(canvas: FlowchartCanvasV1): Edge<FloatingFlowchartEdgeData, 'floatingFlowchart'>[] {
  return canvas.edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    type: 'floatingFlowchart',
    data: {
      source: edge.source,
      target: edge.target,
      label: edge.label,
      arrowStart: edge.arrowStart,
      arrowEnd: edge.arrowEnd,
      lineStyle: edge.lineStyle,
    },
    markerStart: edge.arrowStart ? { type: MarkerType.ArrowClosed } : undefined,
    markerEnd: edge.arrowEnd ? { type: MarkerType.ArrowClosed } : undefined,
    deletable: false,
    reconnectable: false,
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
