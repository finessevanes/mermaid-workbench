import { Handle, Position, type NodeProps } from '@xyflow/react';
import type React from 'react';
import { flowchartNodeSize } from '../flowchart-layout';
import type { FlowchartReactFlowNode } from './flowchart-react-flow';

const shapeClassNames: Record<string, string> = {
  circle: 'circle',
  cylinder: 'cylinder',
  diamond: 'diamond',
  doublecircle: 'doublecircle',
  hexagon: 'hexagon',
  inv_trapezoid: 'inv-trapezoid',
  lean_left: 'lean-left',
  lean_right: 'lean-right',
  rect: 'rect',
  roundedRect: 'rounded-rect',
  squareRect: 'rect',
  stadium: 'stadium',
  subroutine: 'subroutine',
  trapezoid: 'trapezoid',
};

export function safeShapeClass(shape: string): string {
  return shapeClassNames[shape] ?? 'rect';
}

export function FlowchartNode(
  { id, data, selected }: NodeProps<FlowchartReactFlowNode>,
): React.JSX.Element {
  const { width, height } = flowchartNodeSize(data.shape, data.label);
  const shapeClass = safeShapeClass(data.shape);

  return (
    <div
      className={`flowchart-node flowchart-node--${shapeClass}${selected ? ' flowchart-node--selected' : ''}`}
      aria-label={data.label}
      tabIndex={0}
      style={{ width, minHeight: height }}
      onKeyDown={(event) => data.onNudge?.(id, event)}
    >
      <Handle
        type="target"
        position={Position.Top}
        className="flowchart-handle"
      />
      <span>{data.label}</span>
      <Handle
        type="source"
        position={Position.Bottom}
        className="flowchart-handle"
      />
    </div>
  );
}
