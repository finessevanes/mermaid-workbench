import { Position } from '@xyflow/react';

export interface Point {
  x: number;
  y: number;
}

export interface NodeGeometry {
  center: Point;
  size: { width: number; height: number };
  shape: string;
}

function isFinitePoint(point: Point): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}

function validSize(size: NodeGeometry['size']): boolean {
  return Number.isFinite(size.width)
    && Number.isFinite(size.height)
    && size.width > 0
    && size.height > 0;
}

export function nodeBoundaryPoint(
  center: Point,
  size: { width: number; height: number },
  shape: string,
  toward: Point,
): Point {
  if (!isFinitePoint(center) || !isFinitePoint(toward) || !validSize(size)) {
    return { ...center };
  }

  const dx = toward.x - center.x;
  const dy = toward.y - center.y;
  if (dx === 0 && dy === 0) {
    return { ...center };
  }

  const halfWidth = size.width / 2;
  const halfHeight = size.height / 2;
  let scale: number;

  if (shape === 'circle' || shape === 'doublecircle') {
    const radius = Math.min(halfWidth, halfHeight);
    scale = radius / Math.hypot(dx, dy);
  } else if (shape === 'diamond') {
    scale = 1 / (Math.abs(dx) / halfWidth + Math.abs(dy) / halfHeight);
  } else {
    scale = Math.min(
      dx === 0 ? Number.POSITIVE_INFINITY : halfWidth / Math.abs(dx),
      dy === 0 ? Number.POSITIVE_INFINITY : halfHeight / Math.abs(dy),
    );
  }

  if (!Number.isFinite(scale)) {
    return { ...center };
  }

  return { x: center.x + dx * scale, y: center.y + dy * scale };
}

function pointPosition(from: Point, toward: Point): Position {
  const dx = toward.x - from.x;
  const dy = toward.y - from.y;
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0 ? Position.Right : Position.Left;
  }
  return dy >= 0 ? Position.Bottom : Position.Top;
}

export function floatingEdgeEndpoints(
  source: NodeGeometry,
  target: NodeGeometry,
): {
  source: Point;
  target: Point;
  sourcePosition: Position;
  targetPosition: Position;
} {
  return {
    source: nodeBoundaryPoint(source.center, source.size, source.shape, target.center),
    target: nodeBoundaryPoint(target.center, target.size, target.shape, source.center),
    sourcePosition: pointPosition(source.center, target.center),
    targetPosition: pointPosition(target.center, source.center),
  };
}
