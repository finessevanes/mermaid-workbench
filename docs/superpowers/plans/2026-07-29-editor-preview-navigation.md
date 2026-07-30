# Editor Preview Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a collapsible source rail and a bounded, Mac-trackpad-friendly zoomable and pannable Mermaid preview.

**Architecture:** Keep all coordinate calculations in a pure transform module, and contain browser measurement and gesture state in a dedicated `PreviewViewport` component. `EditorView` continues to own draft and autosave state while adding only session-local source-collapse state; the compact library preview remains unchanged.

**Tech Stack:** React 19, TypeScript 5.9, CSS, Vitest, Testing Library, Playwright, native Wheel/Pointer/ResizeObserver browser APIs.

## Global Constraints

- Zoom is clamped to the inclusive range 10%–400% through every interaction.
- Trackpad pinch zooms around the gesture location; ordinary two-finger wheel deltas pan.
- Click-and-drag is the mouse fallback for panning.
- The full editor toolbar contains zoom out, percentage, zoom in, `Fit`, and `100%`.
- The hard zoom clamp is the requested zoom lock; there is no separate lock toggle.
- Source collapse and viewport transforms are session-local UI state and never modify diagram source, records, backups, or browser storage.
- Opening another diagram starts source-expanded and fit-to-view.
- Valid edits, syntax errors, and source collapse preserve the current viewport transform.
- Only `Fit` and automatic-fit resize handling may re-enter or update fit mode.
- Exact three-finger gesture detection is out of scope because it is not reliably exposed to web applications.
- The reusable compact library-card preview stays non-interactive.
- No new runtime dependency is added.

---

## File Structure

- Create `src/client/viewport-transform.ts`: pure transform types, constants, validation, zoom, pan, center, and fit calculations.
- Create `src/client/viewport-transform.test.ts`: deterministic transform-math tests.
- Create `src/client/components/PreviewViewport.tsx`: full editor preview panel, toolbar, SVG measurement, wheel/pointer handling, resize behavior, and error display.
- Create `src/client/components/PreviewViewport.test.tsx`: isolated component tests with controlled `ResizeObserver` and SVG bounds.
- Modify `src/client/components/EditorView.tsx`: session-local source collapse, focus transfer, error marker, and `PreviewViewport` integration.
- Modify `src/client/App.test.tsx`: editor-level collapse, draft preservation, error-marker, and autosave regression coverage.
- Modify `src/client/styles.css`: collapsed desktop rail, narrow-screen source bar, toolbar, and transformable preview surface.
- Modify `e2e/persistence.spec.ts`: real-browser collapse, zoom controls, responsive source bar, and persistence smoke coverage.

### Task 1: Bounded Viewport Transform Math

**Files:**

- Create: `src/client/viewport-transform.ts`
- Create: `src/client/viewport-transform.test.ts`

**Interfaces:**

- Consumes: no application state or DOM APIs.
- Produces:

```ts
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

export function clampPreviewScale(scale: number): number;
export function panViewport(
  transform: ViewportTransform,
  delta: ViewportPoint,
): ViewportTransform;
export function zoomViewportAt(
  transform: ViewportTransform,
  requestedScale: number,
  anchor: ViewportPoint,
): ViewportTransform;
export function centerViewportAtScale(
  viewport: ViewportSize,
  content: ViewportSize,
  requestedScale: number,
): ViewportTransform | null;
export function fitViewport(
  viewport: ViewportSize,
  content: ViewportSize,
  padding?: number,
): ViewportTransform | null;
```

- [ ] **Step 1: Write failing scale, pan, and focal-point tests**

Create `src/client/viewport-transform.test.ts` with explicit boundary and focal-point expectations:

```ts
import { describe, expect, it } from 'vitest';
import {
  MAX_PREVIEW_SCALE,
  MIN_PREVIEW_SCALE,
  clampPreviewScale,
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
});
```

- [ ] **Step 2: Run the focused tests and confirm the missing-module failure**

Run:

```bash
npm test -- src/client/viewport-transform.test.ts
```

Expected: FAIL because `./viewport-transform` does not exist.

- [ ] **Step 3: Implement scale clamping, panning, and anchored zoom**

Create `src/client/viewport-transform.ts` with:

```ts
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
```

- [ ] **Step 4: Run the focused tests and confirm they pass**

Run:

```bash
npm test -- src/client/viewport-transform.test.ts
```

Expected: 3 tests PASS.

- [ ] **Step 5: Add failing fit, center, and invalid-dimension tests**

Extend the imports and suite with:

```ts
import {
  centerViewportAtScale,
  fitViewport,
} from './viewport-transform';

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
```

- [ ] **Step 6: Run the focused tests and confirm the missing-export failure**

Run:

```bash
npm test -- src/client/viewport-transform.test.ts
```

Expected: FAIL because `fitViewport` and `centerViewportAtScale` are not exported.

- [ ] **Step 7: Implement fit and center calculations**

Append helpers that reject non-positive or non-finite dimensions, clamp the resulting scale, and center the scaled content:

```ts
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
```

- [ ] **Step 8: Run transform tests and typecheck**

Run:

```bash
npm test -- src/client/viewport-transform.test.ts
npm run typecheck
```

Expected: all transform tests PASS and TypeScript exits 0.

- [ ] **Step 9: Commit the transform unit**

```bash
git add src/client/viewport-transform.ts src/client/viewport-transform.test.ts
git commit -m "feat: add bounded preview transform math"
```

### Task 2: Interactive Preview Viewport

**Files:**

- Create: `src/client/components/PreviewViewport.tsx`
- Create: `src/client/components/PreviewViewport.test.tsx`
- Modify: `src/client/styles.css:365-424`

**Interfaces:**

- Consumes:

```ts
interface PreviewViewportProps {
  svg: string;
  rendering: boolean;
  error: string | null;
}
```

- Consumes transform functions and constants from `src/client/viewport-transform.ts`.
- Produces:

```ts
export function PreviewViewport(
  props: PreviewViewportProps,
): React.JSX.Element;
```

- The rendered panel includes:
  - heading `Preview`;
  - region labelled `Diagram preview`;
  - controls named `Zoom out`, `Zoom in`, `Fit diagram`, and `Reset zoom to 100%`;
  - status text formatted as a whole-number percentage;
  - the existing `data-testid="mermaid-preview"` on the SVG container.

- [ ] **Step 1: Write failing toolbar and initial-fit component tests**

Create `src/client/components/PreviewViewport.test.tsx`. Install a controllable `ResizeObserver`, render an SVG with a viewBox, give the viewport a deterministic rectangle, and assert initial fit plus accessible toolbar state:

```tsx
// @vitest-environment jsdom

import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { PreviewViewport } from './PreviewViewport';

let resizeCallback: ResizeObserverCallback;

class TestResizeObserver implements ResizeObserver {
  constructor(callback: ResizeObserverCallback) {
    resizeCallback = callback;
  }

  disconnect() {}
  observe() {}
  unobserve() {}
}

const svg =
  '<svg viewBox="0 0 400 200" aria-label="Rendered diagram"></svg>';

function renderViewport() {
  const result = render(
    <PreviewViewport svg={svg} rendering={false} error={null} />,
  );
  const region = screen.getByRole('region', { name: 'Diagram preview' });
  Object.defineProperty(region, 'getBoundingClientRect', {
    value: () => ({
      width: 1000,
      height: 700,
      top: 0,
      left: 0,
      right: 1000,
      bottom: 700,
      x: 0,
      y: 0,
      toJSON: () => undefined,
    }),
  });
  act(() => {
    resizeCallback([], {} as ResizeObserver);
  });
  return result;
}

describe('PreviewViewport', () => {
  beforeEach(() => {
    globalThis.ResizeObserver = TestResizeObserver;
  });

  it('fits valid SVG content and exposes accessible controls', () => {
    renderViewport();

    expect(screen.getByRole('button', { name: 'Zoom out' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Zoom in' })).toBeEnabled();
    expect(
      screen.getByRole('button', { name: 'Fit diagram' }),
    ).toBeEnabled();
    expect(
      screen.getByRole('button', { name: 'Reset zoom to 100%' }),
    ).toBeEnabled();
    expect(screen.getByRole('status', { name: 'Zoom level' }))
      .toHaveTextContent('226%');
  });

  it('increments, resets, and clamps toolbar zoom', async () => {
    const user = userEvent.setup();
    renderViewport();

    await user.click(screen.getByRole('button', { name: 'Reset zoom to 100%' }));
    await user.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(screen.getByRole('status', { name: 'Zoom level' }))
      .toHaveTextContent('110%');

    for (let index = 0; index < 40; index += 1) {
      await user.click(screen.getByRole('button', { name: 'Zoom in' }));
    }
    expect(screen.getByRole('status', { name: 'Zoom level' }))
      .toHaveTextContent('400%');
    expect(screen.getByRole('button', { name: 'Zoom in' })).toBeDisabled();
  });

  it('disables Fit until the SVG has measurable bounds', () => {
    render(
      <PreviewViewport
        svg="<svg></svg>"
        rendering={false}
        error={null}
      />,
    );

    expect(
      screen.getByRole('button', { name: 'Fit diagram' }),
    ).toBeDisabled();
  });
});
```

- [ ] **Step 2: Run the component test and confirm the missing-component failure**

Run:

```bash
npm test -- src/client/components/PreviewViewport.test.tsx
```

Expected: FAIL because `./PreviewViewport` does not exist.

- [ ] **Step 3: Implement the preview panel structure, SVG measurement, initial fit, and toolbar**

Create `PreviewViewport.tsx` with these state and ref boundaries:

```tsx
const [transform, setTransform] = useState<ViewportTransform>({
  x: 0,
  y: 0,
  scale: 1,
});
const [contentSize, setContentSize] = useState<ViewportSize | null>(null);
const viewportRef = useRef<HTMLDivElement>(null);
const canvasRef = useRef<HTMLDivElement>(null);
const automaticFitRef = useRef(true);
const initialFitRef = useRef(false);
```

Use a local SVG measurement helper that prefers a positive four-number `viewBox`, then positive numeric `width` and `height` attributes:

```ts
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
```

After each valid SVG replacement, update `contentSize`. Only run `fitViewport` when `initialFitRef.current` is false. If measurement fails, retry once with `requestAnimationFrame`; keep `Fit` disabled until a size exists.

Render the transform layer with:

```tsx
style={{
  width: contentSize?.width,
  height: contentSize?.height,
  transform: `translate3d(${transform.x}px, ${transform.y}px, 0) scale(${transform.scale})`,
}}
```

Center toolbar zoom steps on the viewport center:

```ts
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
```

`Fit` calls `fitViewport`, sets the returned transform, and sets `automaticFitRef.current = true`. `100%` calls `centerViewportAtScale` with scale `1` and exits automatic fit mode.

- [ ] **Step 4: Add the transform-layer and toolbar styles**

In `styles.css`, preserve `.preview` styles for library cards, but make `.editor-preview` a clipped interaction surface:

```css
.editor-preview {
  position: relative;
  min-height: 35rem;
  flex: 1;
  overflow: hidden;
  touch-action: none;
  cursor: grab;
  background:
    linear-gradient(var(--line) 1px, transparent 1px),
    linear-gradient(90deg, var(--line) 1px, transparent 1px),
    var(--panel-blue);
  background-size: 28px 28px;
}

.editor-preview[data-dragging="true"] { cursor: grabbing; }

.preview__transform {
  position: absolute;
  top: 0;
  left: 0;
  transform-origin: 0 0;
  will-change: transform;
}

.editor-preview .preview__canvas {
  min-width: 0;
  min-height: 0;
  padding: 0;
}

.editor-preview .preview__canvas svg {
  display: block;
  width: 100%;
  height: 100%;
  max-width: none;
  max-height: none;
}

.preview-header__actions,
.preview-toolbar {
  display: flex;
  gap: .4rem;
  align-items: center;
}

.preview-toolbar__button {
  min-width: 2.2rem;
  min-height: 2.2rem;
  padding: .45rem .6rem;
}

.preview-toolbar__zoom {
  min-width: 3.8rem;
  color: var(--ink-soft);
  font-size: .72rem;
  font-weight: 800;
  text-align: center;
}
```

Keep loading and error overlays above the transform layer with explicit `z-index`.

- [ ] **Step 5: Run the toolbar tests and confirm they pass**

Run:

```bash
npm test -- src/client/components/PreviewViewport.test.tsx
```

Expected: toolbar and initial-fit tests PASS.

- [ ] **Step 6: Add failing pinch, two-finger pan, drag, resize, and error-preservation tests**

Extend the component test suite with cases that:

```tsx
it('pinch-zooms at the wheel location and clamps at 10%', () => {
  renderViewport();
  const region = screen.getByRole('region', { name: 'Diagram preview' });
  fireEvent.wheel(region, {
    ctrlKey: true,
    clientX: 200,
    clientY: 150,
    deltaY: 1000,
  });
  expect(screen.getByRole('status', { name: 'Zoom level' }))
    .toHaveTextContent('10%');
  expect(screen.getByRole('button', { name: 'Zoom out' })).toBeDisabled();
});

it('pans with ordinary wheel deltas and primary-pointer drag', () => {
  renderViewport();
  const region = screen.getByRole('region', { name: 'Diagram preview' });
  const layer = screen.getByTestId('preview-transform');
  const initialTransform = layer.style.transform;

  fireEvent.wheel(region, { deltaX: 20, deltaY: 30 });
  expect(layer.style.transform).not.toBe(initialTransform);

  fireEvent.pointerDown(region, {
    button: 0,
    pointerId: 4,
    clientX: 200,
    clientY: 200,
  });
  fireEvent.pointerMove(region, {
    pointerId: 4,
    clientX: 240,
    clientY: 225,
  });
  fireEvent.pointerCancel(region, { pointerId: 4 });
  expect(region).toHaveAttribute('data-dragging', 'false');
});

it('preserves a manual transform across SVG replacement and errors', async () => {
  const user = userEvent.setup();
  const result = renderViewport();
  await user.click(screen.getByRole('button', { name: 'Reset zoom to 100%' }));
  const layer = screen.getByTestId('preview-transform');
  const manualTransform = layer.style.transform;

  result.rerender(
    <PreviewViewport
      svg={'<svg viewBox="0 0 800 500"></svg>'}
      rendering={false}
      error="Parse error"
    />,
  );
  expect(layer.style.transform).toBe(manualTransform);
  expect(screen.getByRole('alert')).toHaveTextContent('Parse error');
});
```

Add a resize test: click `Fit`, update the region rectangle to `800 × 600`, invoke `resizeCallback`, and assert that the transform changes. Then click `100%`, invoke another resize, and assert the manual transform remains unchanged.

```tsx
it('refits on resize only while automatic fit mode is active', async () => {
  const user = userEvent.setup();
  renderViewport();
  const region = screen.getByRole('region', { name: 'Diagram preview' });
  const layer = screen.getByTestId('preview-transform');

  await user.click(screen.getByRole('button', { name: 'Fit diagram' }));
  const firstFit = layer.style.transform;
  Object.defineProperty(region, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      width: 800,
      height: 600,
      top: 0,
      left: 0,
      right: 800,
      bottom: 600,
      x: 0,
      y: 0,
      toJSON: () => undefined,
    }),
  });
  act(() => {
    resizeCallback([], {} as ResizeObserver);
  });
  expect(layer.style.transform).not.toBe(firstFit);

  await user.click(screen.getByRole('button', { name: 'Reset zoom to 100%' }));
  const manualTransform = layer.style.transform;
  act(() => {
    resizeCallback([], {} as ResizeObserver);
  });
  expect(layer.style.transform).toBe(manualTransform);
});
```

- [ ] **Step 7: Run the gesture tests and confirm they fail for missing behavior**

Run:

```bash
npm test -- src/client/components/PreviewViewport.test.tsx
```

Expected: FAIL on wheel, pointer, transform-preservation, and resize assertions.

- [ ] **Step 8: Implement native wheel, pointer capture, and resize behavior**

Attach a native non-passive wheel listener in an effect:

```ts
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
```

Track `{pointerId, x, y}` in a ref. Begin drag only for the primary button, call `setPointerCapture`, pan by successive pointer deltas, and clear drag state on `pointerup`, `pointercancel`, `lostpointercapture`, and unmount. Guard `hasPointerCapture` and `releasePointerCapture` because jsdom and older test shims may not implement them.

Observe the viewport with `ResizeObserver`. On resize, update the fit transform only when `automaticFitRef.current` is true and `contentSize` is measurable. Do not fit merely because the `svg` string changed after the initial valid render.

- [ ] **Step 9: Run the viewport suite, existing preview-hook suite, and typecheck**

Run:

```bash
npm test -- src/client/components/PreviewViewport.test.tsx src/client/use-mermaid-preview.test.tsx
npm run typecheck
```

Expected: all selected tests PASS and TypeScript exits 0.

- [ ] **Step 10: Commit the interactive viewport**

```bash
git add src/client/components/PreviewViewport.tsx src/client/components/PreviewViewport.test.tsx src/client/styles.css
git commit -m "feat: add interactive Mermaid preview viewport"
```

### Task 3: Collapsible Source Rail and Editor Integration

**Files:**

- Modify: `src/client/components/EditorView.tsx:1-355`
- Modify: `src/client/App.test.tsx:225-284`
- Modify: `src/client/styles.css:494-547,582-612`

**Interfaces:**

- Consumes `PreviewViewport` with `{ svg, rendering, error }`.
- Produces source controls with accessible names:
  - `Collapse source`
  - `Expand source`
- Produces `.workspace-grid--source-collapsed` and `.workspace-panel--source-collapsed` for desktop/narrow responsive styling.
- Keeps `draft`, `saveState`, `preview`, and autosave behavior unchanged.

- [ ] **Step 1: Add failing editor-level collapse and draft-preservation tests**

Extend `src/client/App.test.tsx` with:

```tsx
it('collapses source into a rail and restores the unchanged draft', async () => {
  const user = userEvent.setup();
  const client = createMemoryApi({
    projects: [project],
    diagrams: [diagram],
  });
  render(<App client={client} renderDiagram={validRenderer} autosaveDelay={10} />);

  await user.click(await screen.findByRole('button', { name: 'Open Release path' }));
  const source = screen.getByLabelText('Mermaid source');
  fireEvent.change(source, {
    target: { value: 'flowchart LR\n  Draft --> Preserved' },
  });
  await user.click(screen.getByRole('button', { name: 'Collapse source' }));

  const expand = screen.getByRole('button', { name: 'Expand source' });
  expect(expand).toHaveFocus();
  expect(screen.queryByLabelText('Mermaid source')).not.toBeInTheDocument();

  await user.click(expand);
  expect(screen.getByRole('button', { name: 'Collapse source' })).toHaveFocus();
  expect(screen.getByLabelText('Mermaid source')).toHaveValue(
    'flowchart LR\n  Draft --> Preserved',
  );
});

it('shows a source error marker while collapsed', async () => {
  const user = userEvent.setup();
  const client = createMemoryApi({
    projects: [project],
    diagrams: [diagram],
  });
  render(<App client={client} renderDiagram={validRenderer} autosaveDelay={10} />);

  await user.click(await screen.findByRole('button', { name: 'Open Release path' }));
  fireEvent.change(screen.getByLabelText('Mermaid source'), {
    target: { value: 'flowchart LR\n  Idea --> broken[' },
  });
  await screen.findByRole('alert');
  await user.click(screen.getByRole('button', { name: 'Collapse source' }));

  expect(screen.getByText('Source has a syntax error')).toBeInTheDocument();
  expect(screen.getByTestId('mermaid-preview')).toContainHTML('Idea --&gt; Ship');
});
```

- [ ] **Step 2: Run the App tests and confirm missing-control failures**

Run:

```bash
npm test -- src/client/App.test.tsx
```

Expected: FAIL because `Collapse source` and `Expand source` do not exist.

- [ ] **Step 3: Add source-collapse state, focus transfer, and diagram reset**

In `EditorView`:

```tsx
const [sourceCollapsed, setSourceCollapsed] = useState(false);
const collapseSourceRef = useRef<HTMLButtonElement>(null);
const expandSourceRef = useRef<HTMLButtonElement>(null);

const collapseSource = () => {
  setSourceCollapsed(true);
  window.requestAnimationFrame(() => expandSourceRef.current?.focus());
};

const expandSource = () => {
  setSourceCollapsed(false);
  window.requestAnimationFrame(() => collapseSourceRef.current?.focus());
};
```

Reset `sourceCollapsed` to `false` in the existing `[diagram.id]` effect so a newly opened diagram begins expanded.

When expanded, keep the existing inputs and footer mounted in the source panel and add this header control:

```tsx
<button
  ref={collapseSourceRef}
  type="button"
  className="icon-button source-collapse-button"
  aria-label="Collapse source"
  onClick={collapseSource}
>
  <span aria-hidden="true">‹</span>
</button>
```

When collapsed, render:

```tsx
<section
  className="workspace-panel workspace-panel--source-collapsed"
  aria-label="Source"
>
  <button
    ref={expandSourceRef}
    type="button"
    className="source-rail-toggle"
    aria-label="Expand source"
    onClick={expandSource}
  >
    <span aria-hidden="true">›</span>
    <span className="source-rail-toggle__label source-rail-toggle__label--desktop">
      Source
    </span>
    <span className="source-rail-toggle__label source-rail-toggle__label--compact">
      Show source
    </span>
    {preview.error ? (
      <span className="source-rail-toggle__error">
        Source has a syntax error
      </span>
    ) : null}
  </button>
</section>
```

Apply `workspace-grid--source-collapsed` to the workspace grid while collapsed. Because the `draft` remains owned by `EditorView`, conditionally removing the form DOM does not discard its contents or autosave state.

- [ ] **Step 4: Replace the inline editor preview with `PreviewViewport`**

Import the component and replace lines 291–322 with:

```tsx
<PreviewViewport
  key={diagram.id}
  svg={preview.svg}
  rendering={preview.rendering}
  error={preview.error}
/>
```

The `key` intentionally creates a fresh fitted viewport when the selected diagram changes. Source collapse does not affect the key, so it preserves the viewport instance and transform.

- [ ] **Step 5: Add desktop rail and narrow-screen bar styles**

Add:

```css
.workspace-grid--source-collapsed {
  grid-template-columns: 3.75rem minmax(0, 1fr);
}

.workspace-panel--source-collapsed {
  min-height: calc(100vh - 9rem);
}

.source-rail-toggle {
  display: flex;
  width: 100%;
  height: 100%;
  min-height: inherit;
  align-items: center;
  flex-direction: column;
  gap: 1rem;
  padding: 1rem .6rem;
  color: var(--ink-soft);
  background: var(--panel);
  border: 0;
}

.source-rail-toggle__label {
  writing-mode: vertical-rl;
  transform: rotate(180deg);
  color: var(--ink);
  font-size: .76rem;
  font-weight: 850;
  letter-spacing: .08em;
  text-transform: uppercase;
}

.source-rail-toggle__label--compact { display: none; }

.source-rail-toggle__error {
  width: .65rem;
  height: .65rem;
  overflow: hidden;
  margin-top: auto;
  color: transparent;
  background: var(--danger);
  border-radius: 50%;
}
```

At `max-width: 900px`, override the collapsed grid and rail:

```css
.workspace-grid--source-collapsed { grid-template-columns: 1fr; }
.workspace-panel--source-collapsed { min-height: 3.5rem; }
.source-rail-toggle {
  min-height: 3.5rem;
  flex-direction: row;
  justify-content: center;
  padding: .65rem 1rem;
}
.source-rail-toggle__label {
  writing-mode: horizontal-tb;
  transform: none;
}
.source-rail-toggle__label--desktop { display: none; }
.source-rail-toggle__label--compact { display: inline; }
.source-rail-toggle__error { margin: 0 0 0 auto; }
```

Group the source header hint and collapse control without reducing the existing button focus target below 44 CSS pixels.

- [ ] **Step 6: Run App and viewport tests**

Run:

```bash
npm test -- src/client/App.test.tsx src/client/components/PreviewViewport.test.tsx
```

Expected: collapse, draft preservation, syntax error, viewport, autosave, and conflict tests PASS.

- [ ] **Step 7: Verify source collapse does not change persistence behavior**

Run:

```bash
npm test -- src/client/App.test.tsx src/client/save-state.test.ts
npm run typecheck
```

Expected: all selected tests PASS and TypeScript exits 0.

- [ ] **Step 8: Commit editor integration**

```bash
git add src/client/components/EditorView.tsx src/client/App.test.tsx src/client/styles.css
git commit -m "feat: collapse source editor into responsive rail"
```

### Task 4: Browser Workflow and Full Verification

**Files:**

- Modify: `e2e/persistence.spec.ts:1-39`

**Interfaces:**

- Consumes the completed editor controls and existing local API.
- Produces browser-level evidence for collapse/expand, toolbar zoom, responsive rail layout, autosave, and reload persistence.

- [ ] **Step 1: Extend the persistence smoke test before implementation verification**

Set the page to desktop size at the beginning:

```ts
await page.setViewportSize({ width: 1440, height: 900 });
```

After the first valid SVG appears, add:

```ts
const previewRegion = page.getByRole('region', { name: 'Diagram preview' });
const previewLayer = page.getByTestId('preview-transform');
const expandedPreviewWidth = (await previewRegion.boundingBox())?.width ?? 0;

await page.getByRole('button', { name: 'Collapse source' }).click();
await expect(
  page.getByRole('button', { name: 'Expand source' }),
).toBeFocused();
const collapsedPreviewWidth = (await previewRegion.boundingBox())?.width ?? 0;
expect(collapsedPreviewWidth).toBeGreaterThan(expandedPreviewWidth);

await page
  .getByRole('button', { name: 'Reset zoom to 100%' })
  .click();
await page.getByRole('button', { name: 'Zoom in' }).click();
await expect(
  page.getByRole('status', { name: 'Zoom level' }),
).toHaveText('110%');
await expect(previewLayer).toHaveCSS(
  'transform',
  /matrix\(1\.1, 0, 0, 1\.1,/,
);

await page.setViewportSize({ width: 800, height: 900 });
const compactSource = page.locator('.workspace-panel--source-collapsed');
const compactBounds = await compactSource.boundingBox();
expect(compactBounds?.width ?? 0).toBeGreaterThan(
  compactBounds?.height ?? Number.POSITIVE_INFINITY,
);

await page.getByRole('button', { name: 'Expand source' }).click();
await expect(page.getByLabel('Mermaid source')).toHaveValue(source);
```

Keep the existing reload assertions after these interactions to prove navigation state did not alter persistence.

- [ ] **Step 2: Stop the interactive development server before isolated E2E**

The Playwright configuration requires exclusive use of ports 5173 and 4317 and starts its own server with an isolated data directory. Stop only the known `npm run dev` process for this worktree, then verify both ports are free:

```bash
lsof -nP -iTCP:5173 -sTCP:LISTEN
lsof -nP -iTCP:4317 -sTCP:LISTEN
```

Expected: both commands produce no listener rows.

- [ ] **Step 3: Run the browser test**

Run:

```bash
npm run test:e2e
```

Expected: the persistence/navigation Playwright test PASSes using the isolated E2E database.

- [ ] **Step 4: Run the complete automated verification**

Run:

```bash
npm test
npm run build
```

Expected: the complete Vitest suite PASSes; TypeScript and Vite production build exit 0.

- [ ] **Step 5: Restart the development application and verify health**

Run:

```bash
npm run dev
```

Keep it running, then verify:

```bash
curl --silent --show-error http://127.0.0.1:4317/api/health
curl --silent --show-error --head http://127.0.0.1:5173/
```

Expected: API returns `{"status":"ok"}` and UI returns HTTP 200.

- [ ] **Step 6: Perform real Mac trackpad verification**

With the editor open on a valid diagram:

1. Pinch over a recognizable node and confirm that node stays under the gesture while scale changes.
2. Pinch repeatedly inward and outward and confirm the displayed scale stops exactly at 10% and 400%.
3. Slide two fingers and confirm the diagram pans in both axes without the page scrolling.
4. Move the pointer outside the preview and confirm ordinary page scrolling still works.
5. Click-drag the canvas, release outside the original press point, and confirm the cursor leaves the dragging state.
6. Collapse and expand source and confirm the diagram keeps its zoom and pan position.
7. Introduce a syntax error and confirm the last valid SVG, transform, error alert, and collapsed-rail error marker remain visible.

Expected: all seven checks match the approved design. Record any hardware-specific sensitivity issue before adjusting the `0.01` pinch exponent.

- [ ] **Step 7: Confirm the worktree contains only intended changes**

Run:

```bash
git status --short
git diff --check
git log --oneline -6
```

Expected: no whitespace errors, no uncommitted implementation files, and the feature commits appear after design commit `4c22e75`.

- [ ] **Step 8: Commit the browser verification**

```bash
git add e2e/persistence.spec.ts
git commit -m "test: verify editor preview navigation"
```

If Step 7 ran before this commit, repeat `git status --short` afterward and expect a clean worktree.
