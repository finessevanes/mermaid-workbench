export const MIN_PREVIEW_SCALE = 0.1;
export const MAX_PREVIEW_SCALE = 4;
export const PREVIEW_SCALE_STEP = 0.1;

export interface ViewportPoint {
  x: number;
  y: number;
}

export interface ViewportSize {
  width: number;
  height: number;
}

export interface ViewportTransform {
  x: number;
  y: number;
  scale: number;
}

export function clampPreviewScale(scale: number): number {
  if (!Number.isFinite(scale)) {
    return 1;
  }
  return Math.min(MAX_PREVIEW_SCALE, Math.max(MIN_PREVIEW_SCALE, scale));
}

export function panViewport(
  transform: ViewportTransform,
  delta: ViewportPoint,
): ViewportTransform {
  const deltaX = Number.isFinite(delta.x) ? delta.x : 0;
  const deltaY = Number.isFinite(delta.y) ? delta.y : 0;
  return {
    ...transform,
    x: transform.x + deltaX,
    y: transform.y + deltaY,
  };
}

export function zoomViewportAt(
  transform: ViewportTransform,
  requestedScale: number,
  anchor: ViewportPoint,
): ViewportTransform {
  const scale = clampPreviewScale(requestedScale);
  const worldX = (anchor.x - transform.x) / transform.scale;
  const worldY = (anchor.y - transform.y) / transform.scale;
  return {
    x: anchor.x - worldX * scale,
    y: anchor.y - worldY * scale,
    scale,
  };
}

function isUsableSize(size: ViewportSize): boolean {
  return (
    Number.isFinite(size.width) &&
    Number.isFinite(size.height) &&
    size.width > 0 &&
    size.height > 0
  );
}

export function centerViewportAtScale(
  viewport: ViewportSize,
  content: ViewportSize,
  requestedScale: number,
): ViewportTransform | null {
  if (!isUsableSize(viewport) || !isUsableSize(content)) {
    return null;
  }
  const scale = clampPreviewScale(requestedScale);
  return {
    x: (viewport.width - content.width * scale) / 2,
    y: (viewport.height - content.height * scale) / 2,
    scale,
  };
}

export function fitViewport(
  viewport: ViewportSize,
  content: ViewportSize,
  padding = 48,
): ViewportTransform | null {
  if (!isUsableSize(viewport) || !isUsableSize(content)) {
    return null;
  }
  const safePadding = Number.isFinite(padding) ? Math.max(0, padding) : 0;
  const availableWidth = viewport.width - safePadding * 2;
  const availableHeight = viewport.height - safePadding * 2;
  if (availableWidth <= 0 || availableHeight <= 0) {
    return null;
  }
  const scale = clampPreviewScale(
    Math.min(
      availableWidth / content.width,
      availableHeight / content.height,
    ),
  );
  return centerViewportAtScale(viewport, content, scale);
}
