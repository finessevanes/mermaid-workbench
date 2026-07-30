import {
  BaseEdge,
  EdgeLabelRenderer,
  MarkerType,
  getBezierPath,
  useInternalNode,
  type EdgeProps,
} from '@xyflow/react';
import type React from 'react';
import { floatingEdgeEndpoints, type NodeGeometry } from './floating-edge-geometry';
import type { FlowchartReactFlowNode } from './flowchart-react-flow';

export interface FloatingFlowchartEdgeData extends Record<string, unknown> {
  source: string;
  target: string;
  label?: string;
  arrowStart: boolean;
  arrowEnd: boolean;
  lineStyle: 'solid' | 'dotted' | 'thick' | 'invisible';
}

function toGeometry(node: NonNullable<ReturnType<typeof useInternalNode<FlowchartReactFlowNode>>>): NodeGeometry | null {
  const width = node.measured.width ?? node.width;
  const height = node.measured.height ?? node.height;
  const position = node.internals.positionAbsolute;
  if (
    typeof width !== 'number'
    || typeof height !== 'number'
    || !Number.isFinite(width)
    || !Number.isFinite(height)
    || !Number.isFinite(position.x)
    || !Number.isFinite(position.y)
  ) {
    return null;
  }
  return {
    center: { x: position.x + width / 2, y: position.y + height / 2 },
    size: { width, height },
    shape: node.data.shape,
  };
}

export function FloatingFlowchartEdge({
  id,
  source,
  target,
  data,
  markerStart: providedMarkerStart,
  markerEnd: providedMarkerEnd,
}: EdgeProps): React.JSX.Element | null {
  const sourceNode = useInternalNode<FlowchartReactFlowNode>(source);
  const targetNode = useInternalNode<FlowchartReactFlowNode>(target);
  const sourceGeometry = sourceNode ? toGeometry(sourceNode) : null;
  const targetGeometry = targetNode ? toGeometry(targetNode) : null;
  const edgeData = data as FloatingFlowchartEdgeData | undefined;

  if (!sourceGeometry || !targetGeometry || !edgeData) {
    return null;
  }

  const endpoints = floatingEdgeEndpoints(sourceGeometry, targetGeometry);
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX: endpoints.source.x,
    sourceY: endpoints.source.y,
    sourcePosition: endpoints.sourcePosition,
    targetX: endpoints.target.x,
    targetY: endpoints.target.y,
    targetPosition: endpoints.targetPosition,
  });
  const markerStart = providedMarkerStart ?? (edgeData.arrowStart ? MarkerType.ArrowClosed : undefined);
  const markerEnd = providedMarkerEnd ?? (edgeData.arrowEnd ? MarkerType.ArrowClosed : undefined);

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        markerStart={markerStart}
        markerEnd={markerEnd}
        className={`flowchart-edge flowchart-edge--${edgeData.lineStyle}`}
      />
      {edgeData.label ? (
        <EdgeLabelRenderer>
          <span
            className="flowchart-edge__label"
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
          >
            {edgeData.label}
          </span>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}
