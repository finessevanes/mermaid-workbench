import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import type React from 'react';
import {
  MAX_PREVIEW_SCALE,
  MIN_PREVIEW_SCALE,
  PREVIEW_SCALE_STEP,
  centerViewportAtScale,
  fitViewport,
  panViewport,
  zoomViewportAt,
  type ViewportSize,
  type ViewportTransform,
} from '../viewport-transform';

interface PreviewViewportProps {
  svg: string;
  rendering: boolean;
  error: string | null;
  sourceLayoutRevision?: number;
}

function measureSvg(svgElement: SVGSVGElement): ViewportSize | null {
  const viewBox = svgElement
    .getAttribute('viewBox')
    ?.trim()
    .split(/[,\s]+/)
    .map(Number);
  if (
    viewBox?.length === 4 &&
    Number.isFinite(viewBox[2]) &&
    Number.isFinite(viewBox[3]) &&
    viewBox[2] > 0 &&
    viewBox[3] > 0
  ) {
    return { width: viewBox[2], height: viewBox[3] };
  }
  const width = Number.parseFloat(svgElement.getAttribute('width') ?? '');
  const height = Number.parseFloat(svgElement.getAttribute('height') ?? '');
  return Number.isFinite(width) &&
    Number.isFinite(height) &&
    width > 0 &&
    height > 0
    ? { width, height }
    : null;
}

function viewportSize(element: HTMLDivElement): ViewportSize {
  const bounds = element.getBoundingClientRect();
  return { width: bounds.width, height: bounds.height };
}

function releasePointerCapture(
  viewport: HTMLDivElement | null,
  pointerId: number,
) {
  if (
    viewport &&
    typeof viewport.hasPointerCapture === 'function' &&
    viewport.hasPointerCapture(pointerId) &&
    typeof viewport.releasePointerCapture === 'function'
  ) {
    viewport.releasePointerCapture(pointerId);
  }
}

export function PreviewViewport(
  props: PreviewViewportProps,
): React.JSX.Element {
  const [transform, setTransform] = useState<ViewportTransform>({
    x: 0,
    y: 0,
    scale: 1,
  });
  const [contentSize, setContentSize] = useState<ViewportSize | null>(null);
  const [dragging, setDragging] = useState(false);
  const viewportRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const automaticFitRef = useRef(true);
  const initialFitRef = useRef(false);
  const contentSizeRef = useRef<ViewportSize | null>(null);
  const fittedViewportSizeRef = useRef<ViewportSize | null>(null);
  const sourceLayoutRevisionRef = useRef(props.sourceLayoutRevision ?? 0);
  const sourceLayoutFitSuppressionRevisionRef = useRef<number | null>(null);
  const pointerRef = useRef<{ pointerId: number; x: number; y: number } | null>(
    null,
  );
  const pointerCaptureViewportRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    const sourceLayoutRevision = props.sourceLayoutRevision ?? 0;
    if (
      sourceLayoutRevision !== sourceLayoutRevisionRef.current &&
      automaticFitRef.current
    ) {
      sourceLayoutFitSuppressionRevisionRef.current = sourceLayoutRevision;
    }
    sourceLayoutRevisionRef.current = sourceLayoutRevision;
  }, [props.sourceLayoutRevision]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const svgElement = canvas?.querySelector('svg');
    if (!svgElement) {
      setContentSize(null);
      return;
    }

    const updateSize = () => {
      const nextSize = measureSvg(svgElement);
      setContentSize(nextSize);
      return nextSize;
    };

    if (!updateSize()) {
      const frame = window.requestAnimationFrame(updateSize);
      return () => window.cancelAnimationFrame(frame);
    }
  }, [props.svg]);

  useEffect(() => {
    contentSizeRef.current = contentSize;
    const viewport = viewportRef.current;
    if (!viewport || !contentSize || initialFitRef.current) {
      return;
    }
    const size = viewportSize(viewport);
    const fitted = fitViewport(size, contentSize);
    if (fitted) {
      setTransform(fitted);
      initialFitRef.current = true;
      fittedViewportSizeRef.current = size;
    }
  }, [contentSize]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || typeof ResizeObserver === 'undefined') {
      return;
    }

    const applyFit = () => {
      const sourceLayoutRevision = sourceLayoutRevisionRef.current;
      if (
        sourceLayoutFitSuppressionRevisionRef.current === sourceLayoutRevision
      ) {
        sourceLayoutFitSuppressionRevisionRef.current = null;
        return;
      }
      const contentSize = contentSizeRef.current;
      if (!automaticFitRef.current || !contentSize) {
        return;
      }
      const size = viewportSize(viewport);
      const previousSize = fittedViewportSizeRef.current;
      if (
        initialFitRef.current &&
        previousSize?.width === size.width &&
        previousSize.height === size.height
      ) {
        return;
      }
      const fitted = fitViewport(size, contentSize);
      if (fitted) {
        setTransform(fitted);
        initialFitRef.current = true;
        fittedViewportSizeRef.current = size;
      }
    };

    const observer = new ResizeObserver(applyFit);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) {
      return;
    }

    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      automaticFitRef.current = false;
      if (event.ctrlKey) {
        const bounds = viewport.getBoundingClientRect();
        const zoomFactor = Math.exp(-event.deltaY * 0.01);
        setTransform((current) =>
          zoomViewportAt(current, current.scale * zoomFactor, {
            x: event.clientX - bounds.left,
            y: event.clientY - bounds.top,
          }),
        );
        return;
      }
      setTransform((current) =>
        panViewport(current, { x: -event.deltaX, y: -event.deltaY }),
      );
    };

    viewport.addEventListener('wheel', handleWheel, { passive: false });
    return () => viewport.removeEventListener('wheel', handleWheel);
  }, []);

  useEffect(() => () => {
    const activePointer = pointerRef.current;
    const pointerViewport = pointerCaptureViewportRef.current;
    pointerRef.current = null;
    pointerCaptureViewportRef.current = null;
    if (activePointer) {
      releasePointerCapture(pointerViewport, activePointer.pointerId);
    }
  }, []);

  const zoomFromCenter = (requestedScale: number) => {
    const viewport = viewportRef.current;
    if (!viewport) {
      return;
    }
    automaticFitRef.current = false;
    const bounds = viewport.getBoundingClientRect();
    setTransform((current) =>
      zoomViewportAt(current, requestedScale, {
        x: bounds.width / 2,
        y: bounds.height / 2,
      }),
    );
  };

  const fitDiagram = () => {
    const viewport = viewportRef.current;
    if (!viewport || !contentSize) {
      return;
    }
    const fitted = fitViewport(viewportSize(viewport), contentSize);
    if (fitted) {
      setTransform(fitted);
      automaticFitRef.current = true;
      initialFitRef.current = true;
      fittedViewportSizeRef.current = viewportSize(viewport);
    }
  };

  const resetZoom = () => {
    const viewport = viewportRef.current;
    if (!viewport || !contentSize) {
      return;
    }
    const centered = centerViewportAtScale(
      viewportSize(viewport),
      contentSize,
      1,
    );
    if (centered) {
      automaticFitRef.current = false;
      setTransform(centered);
    }
  };

  const endDrag = (event?: ReactPointerEvent<HTMLDivElement>) => {
    const activePointer = pointerRef.current;
    if (!activePointer || (event && event.pointerId !== activePointer.pointerId)) {
      return;
    }
    const viewport = event?.currentTarget ?? pointerCaptureViewportRef.current;
    pointerRef.current = null;
    pointerCaptureViewportRef.current = null;
    setDragging(false);
    releasePointerCapture(viewport, activePointer.pointerId);
  };

  const startDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    automaticFitRef.current = false;
    pointerRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
    };
    pointerCaptureViewportRef.current = event.currentTarget;
    if (typeof event.currentTarget.setPointerCapture === 'function') {
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    setDragging(true);
  };

  const moveDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const activePointer = pointerRef.current;
    if (!activePointer || event.pointerId !== activePointer.pointerId) {
      return;
    }
    const delta = {
      x: event.clientX - activePointer.x,
      y: event.clientY - activePointer.y,
    };
    pointerRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
    };
    setTransform((current) => panViewport(current, delta));
  };

  const loading: ReactNode =
    props.rendering && props.svg.length === 0 ? (
      <div className="preview__loading">Rendering diagram…</div>
    ) : null;

  return (
    <section className="preview-viewport" aria-labelledby="preview-viewport-heading">
      <header className="preview-header">
        <h2 id="preview-viewport-heading">Preview</h2>
        <div className="preview-header__actions">
          <div className="preview-toolbar" aria-label="Preview controls">
            <button
              type="button"
              className="preview-toolbar__button"
              aria-label="Zoom out"
              disabled={transform.scale <= MIN_PREVIEW_SCALE}
              onClick={() => zoomFromCenter(transform.scale - PREVIEW_SCALE_STEP)}
            >
              −
            </button>
            <output className="preview-toolbar__zoom" role="status" aria-label="Zoom level">
              {Math.round(transform.scale * 100)}%
            </output>
            <button
              type="button"
              className="preview-toolbar__button"
              aria-label="Zoom in"
              disabled={transform.scale >= MAX_PREVIEW_SCALE}
              onClick={() => zoomFromCenter(transform.scale + PREVIEW_SCALE_STEP)}
            >
              +
            </button>
            <button
              type="button"
              className="preview-toolbar__button"
              aria-label="Fit diagram"
              disabled={!contentSize}
              onClick={fitDiagram}
            >
              Fit
            </button>
            <button
              type="button"
              className="preview-toolbar__button"
              aria-label="Reset zoom to 100%"
              disabled={!contentSize}
              onClick={resetZoom}
            >
              100%
            </button>
          </div>
        </div>
      </header>

      <div
        ref={viewportRef}
        className="editor-preview"
        role="region"
        aria-label="Diagram preview"
        data-dragging={dragging}
        onPointerDown={startDrag}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onLostPointerCapture={endDrag}
      >
        {loading}
        <div
          className="preview__transform"
          data-testid="preview-transform"
          style={{
            width: contentSize?.width,
            height: contentSize?.height,
            transform: `translate3d(${transform.x}px, ${transform.y}px, 0) scale(${transform.scale})`,
          }}
        >
          <div
            ref={canvasRef}
            className="preview__canvas"
            data-testid="mermaid-preview"
            dangerouslySetInnerHTML={{ __html: props.svg }}
          />
        </div>
        <div className="preview__error" role="alert" aria-live="assertive">
          {props.error ? (
            <>
              <strong>Mermaid syntax error</strong>
              <span>{props.error}</span>
            </>
          ) : null}
        </div>
      </div>
    </section>
  );
}
