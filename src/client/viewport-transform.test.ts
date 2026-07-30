import { describe, expect, it } from 'vitest';
import {
  MAX_PREVIEW_SCALE,
  MIN_PREVIEW_SCALE,
  centerViewportAtScale,
  clampPreviewScale,
  fitViewport,
  panViewport,
  zoomViewportAt,
} from './viewport-transform';

describe('viewport transforms', () => {
  it('clamps zoom to the inclusive limits and rejects non-finite values', () => {
    expect(clampPreviewScale(0.01)).toBe(MIN_PREVIEW_SCALE);
    expect(clampPreviewScale(0.1)).toBe(MIN_PREVIEW_SCALE);
    expect(clampPreviewScale(2.25)).toBe(2.25);
    expect(clampPreviewScale(4)).toBe(MAX_PREVIEW_SCALE);
    expect(clampPreviewScale(9)).toBe(MAX_PREVIEW_SCALE);
    expect(clampPreviewScale(Number.NaN)).toBe(1);
    expect(clampPreviewScale(Number.POSITIVE_INFINITY)).toBe(1);
  });

  it('adds finite pan deltas without changing scale', () => {
    expect(
      panViewport(
        { x: 20, y: 30, scale: 1.5 },
        { x: -7, y: 9 },
      ),
    ).toEqual({ x: 13, y: 39, scale: 1.5 });
  });

  it('keeps the world point under the zoom anchor fixed on screen', () => {
    const before = { x: 40, y: 20, scale: 1 };
    const anchor = { x: 240, y: 120 };
    const worldPoint = {
      x: (anchor.x - before.x) / before.scale,
      y: (anchor.y - before.y) / before.scale,
    };
    const after = zoomViewportAt(before, 2, anchor);

    expect(after.x + worldPoint.x * after.scale).toBeCloseTo(anchor.x);
    expect(after.y + worldPoint.y * after.scale).toBeCloseTo(anchor.y);
    expect(after.scale).toBe(2);
  });

  it('fits wide and tall content inside the padded viewport', () => {
    expect(
      fitViewport(
        { width: 1000, height: 700 },
        { width: 1600, height: 400 },
        50,
      ),
    ).toEqual({ x: 50, y: 237.5, scale: 0.5625 });

    expect(
      fitViewport(
        { width: 700, height: 1000 },
        { width: 400, height: 1600 },
        50,
      ),
    ).toEqual({ x: 237.5, y: 50, scale: 0.5625 });
  });

  it('centers content at a requested bounded scale', () => {
    expect(
      centerViewportAtScale(
        { width: 800, height: 600 },
        { width: 300, height: 200 },
        1,
      ),
    ).toEqual({ x: 250, y: 200, scale: 1 });
  });

  it('returns null for zero or non-finite viewport and content dimensions', () => {
    expect(
      fitViewport(
        { width: 0, height: 600 },
        { width: 300, height: 200 },
      ),
    ).toBeNull();
    expect(
      fitViewport(
        { width: 800, height: Number.NaN },
        { width: 300, height: 200 },
      ),
    ).toBeNull();
    expect(
      centerViewportAtScale(
        { width: 800, height: 600 },
        { width: 0, height: 200 },
        1,
      ),
    ).toBeNull();
  });
});
