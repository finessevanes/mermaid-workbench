import { Position } from '@xyflow/react';
import { describe, expect, it } from 'vitest';
import {
  floatingEdgeEndpoints,
  nodeBoundaryPoint,
  type NodeGeometry,
} from './floating-edge-geometry';

const center = { x: 100, y: 100 };
const size = { width: 80, height: 40 };

function expectPoint(point: { x: number; y: number }, expected: { x: number; y: number }) {
  expect(point.x).toBeCloseTo(expected.x);
  expect(point.y).toBeCloseTo(expected.y);
}

describe('nodeBoundaryPoint', () => {
  it.each([
    [{ x: 200, y: 100 }, { x: 140, y: 100 }],
    [{ x: 0, y: 100 }, { x: 60, y: 100 }],
    [{ x: 100, y: 0 }, { x: 100, y: 80 }],
    [{ x: 100, y: 200 }, { x: 100, y: 120 }],
    [{ x: 200, y: 150 }, { x: 140, y: 120 }],
  ])('intersects a rectangle boundary toward %o', (toward, expected) => {
    expectPoint(nodeBoundaryPoint(center, size, 'rect', toward), expected);
  });

  it.each([
    [{ x: 200, y: 100 }, { x: 120, y: 100 }],
    [{ x: 0, y: 100 }, { x: 80, y: 100 }],
    [{ x: 100, y: 0 }, { x: 100, y: 80 }],
    [{ x: 100, y: 200 }, { x: 100, y: 120 }],
    [{ x: 200, y: 200 }, { x: 100 + Math.SQRT1_2 * 20, y: 100 + Math.SQRT1_2 * 20 }],
  ])('intersects a circle boundary toward %o', (toward, expected) => {
    expectPoint(nodeBoundaryPoint(center, size, 'circle', toward), expected);
  });

  it.each([
    [{ x: 200, y: 100 }, { x: 140, y: 100 }],
    [{ x: 0, y: 100 }, { x: 60, y: 100 }],
    [{ x: 100, y: 0 }, { x: 100, y: 80 }],
    [{ x: 100, y: 200 }, { x: 100, y: 120 }],
    [{ x: 200, y: 200 }, { x: 113.33333333333333, y: 113.33333333333333 }],
  ])('intersects a diamond boundary toward %o', (toward, expected) => {
    expectPoint(nodeBoundaryPoint(center, size, 'diamond', toward), expected);
  });

  it('returns finite, centered points for coincident and degenerate inputs', () => {
    for (const point of [
      nodeBoundaryPoint(center, size, 'rect', center),
      nodeBoundaryPoint(center, { width: 0, height: 0 }, 'circle', { x: 200, y: 100 }),
      nodeBoundaryPoint(center, { width: Number.NaN, height: Number.POSITIVE_INFINITY }, 'diamond', { x: 200, y: 200 }),
    ]) {
      expect(Number.isFinite(point.x)).toBe(true);
      expect(Number.isFinite(point.y)).toBe(true);
      expect(point).toEqual(center);
    }
  });
});

describe('floatingEdgeEndpoints', () => {
  const source: NodeGeometry = {
    center: { x: 100, y: 100 },
    size,
    shape: 'rect',
  };
  const target: NodeGeometry = {
    center: { x: 300, y: 100 },
    size,
    shape: 'circle',
  };

  it('chooses opposite horizontal sides and shape-aware boundary points', () => {
    expect(floatingEdgeEndpoints(source, target)).toEqual({
      source: { x: 140, y: 100 },
      target: { x: 280, y: 100 },
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
    });
  });

  it('swaps attachment sides when the source and target are swapped', () => {
    const forward = floatingEdgeEndpoints(source, target);
    const reverse = floatingEdgeEndpoints(target, source);

    expect(reverse.sourcePosition).toBe(forward.targetPosition);
    expect(reverse.targetPosition).toBe(forward.sourcePosition);
  });
});
