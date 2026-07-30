// @vitest-environment jsdom

import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PreviewViewport } from './PreviewViewport';

let resizeCallback: ResizeObserverCallback;
const originalClipboard = navigator.clipboard;

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

function transformValues(transform: string) {
  const values = transform.match(
    /translate3d\(([-\d.]+)px, ([-\d.]+)px, 0\) scale\(([-\d.]+)\)/,
  );
  if (!values) {
    throw new Error(`Expected a viewport transform, received: ${transform}`);
  }
  return {
    x: Number(values[1]),
    y: Number(values[2]),
    scale: Number(values[3]),
  };
}

function pointerEvent(
  type: string,
  pointerId: number,
  init: MouseEventInit = {},
) {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    ...init,
  });
  Object.defineProperty(event, 'pointerId', { value: pointerId });
  return event;
}

function renderViewport(bounds = { left: 0, top: 0 }) {
  const result = render(
    <PreviewViewport svg={svg} rendering={false} error={null} />,
  );
  const region = screen.getByRole('region', { name: 'Diagram preview' });
  Object.defineProperty(region, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      width: 1000,
      height: 700,
      top: bounds.top,
      left: bounds.left,
      right: bounds.left + 1000,
      bottom: bounds.top + 700,
      x: bounds.left,
      y: bounds.top,
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

  afterEach(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: originalClipboard,
    });
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

  it('keeps the diagram point under a pinch wheel event fixed in viewport coordinates', () => {
    renderViewport({ left: 80, top: 40 });
    const region = screen.getByRole('region', { name: 'Diagram preview' });
    const layer = screen.getByTestId('preview-transform');
    const before = transformValues(layer.style.transform);
    const anchor = { x: 200, y: 150 };
    const worldPoint = {
      x: (anchor.x - before.x) / before.scale,
      y: (anchor.y - before.y) / before.scale,
    };

    fireEvent.wheel(region, {
      ctrlKey: true,
      clientX: 280,
      clientY: 190,
      deltaY: -20,
    });

    const after = transformValues(layer.style.transform);
    expect(after.scale).toBeGreaterThan(before.scale);
    expect(after.x + worldPoint.x * after.scale).toBeCloseTo(anchor.x);
    expect(after.y + worldPoint.y * after.scale).toBeCloseTo(anchor.y);
  });

  it('pans with ordinary wheel deltas', () => {
    renderViewport();
    const region = screen.getByRole('region', { name: 'Diagram preview' });
    const layer = screen.getByTestId('preview-transform');
    const initialTransform = layer.style.transform;

    fireEvent.wheel(region, { deltaX: 20, deltaY: 30 });
    expect(layer.style.transform).not.toBe(initialTransform);
  });

  it('pans the current viewport transform by primary-pointer drag', () => {
    renderViewport();
    const region = screen.getByRole('region', { name: 'Diagram preview' });
    const layer = screen.getByTestId('preview-transform');
    const before = transformValues(layer.style.transform);

    const pointerDown = pointerEvent('pointerdown', 4, {
      button: 0,
      clientX: 200,
      clientY: 200,
    });
    fireEvent(region, pointerDown);
    expect(pointerDown.defaultPrevented).toBe(true);

    fireEvent(region, pointerEvent('pointermove', 4, {
      clientX: 240,
      clientY: 225,
    }));
    const after = transformValues(layer.style.transform);
    expect(after.x).toBeCloseTo(before.x + 40);
    expect(after.y).toBeCloseTo(before.y + 25);
    expect(after.scale).toBe(before.scale);
  });

  it.each([
    [
      'pointer up',
      (region: HTMLElement) => fireEvent(region, pointerEvent('pointerup', 9)),
    ],
    [
      'pointer cancel',
      (region: HTMLElement) => fireEvent(region, pointerEvent('pointercancel', 9)),
    ],
    [
      'lost pointer capture',
      (region: HTMLElement) =>
        fireEvent(region, pointerEvent('lostpointercapture', 9)),
    ],
  ])('releases active pointer capture after %s', (_, endDrag) => {
    renderViewport();
    const region = screen.getByRole('region', { name: 'Diagram preview' });
    let capturedPointerId: number | null = null;
    const setPointerCapture = vi.fn((pointerId: number) => {
      capturedPointerId = pointerId;
    });
    const hasPointerCapture = vi.fn(
      (pointerId: number) => capturedPointerId === pointerId,
    );
    const releasePointerCapture = vi.fn((pointerId: number) => {
      capturedPointerId = null;
      return pointerId;
    });
    Object.defineProperties(region, {
      setPointerCapture: { configurable: true, value: setPointerCapture },
      hasPointerCapture: { configurable: true, value: hasPointerCapture },
      releasePointerCapture: {
        configurable: true,
        value: releasePointerCapture,
      },
    });

    fireEvent(region, pointerEvent('pointerdown', 9, {
      button: 0,
      clientX: 200,
      clientY: 200,
    }));
    endDrag(region);

    expect(setPointerCapture).toHaveBeenCalledWith(9);
    expect(releasePointerCapture).toHaveBeenCalledWith(9);
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

  it('copies the exact Mermaid syntax error for external troubleshooting', async () => {
    const user = userEvent.setup();
    const syntaxError =
      "Parse error on line 5: Expecting 'SEMI', 'NEWLINE', got 'NODE_STRING'";
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });

    render(
      <PreviewViewport
        svg={svg}
        rendering={false}
        error={syntaxError}
      />,
    );

    await user.click(
      screen.getByRole('button', { name: 'Copy Mermaid syntax error' }),
    );

    expect(writeText).toHaveBeenCalledWith(syntaxError);
    expect(screen.getByRole('button', { name: 'Copy Mermaid syntax error' }))
      .toHaveTextContent('Copied');
  });

  it('does not refit replacement SVG content from an initial observer notification', () => {
    const result = renderViewport();
    const layer = screen.getByTestId('preview-transform');
    const initialTransform = layer.style.transform;

    result.rerender(
      <PreviewViewport
        svg={'<svg viewBox="0 0 800 500"></svg>'}
        rendering={false}
        error={null}
      />,
    );
    act(() => {
      resizeCallback([], {} as ResizeObserver);
    });

    expect(layer.style.transform).toBe(initialTransform);
  });

  it('releases active pointer capture during unmount', () => {
    const result = renderViewport();
    const region = screen.getByRole('region', { name: 'Diagram preview' });
    let capturedPointerId: number | null = null;
    const setPointerCapture = vi.fn((pointerId: number) => {
      capturedPointerId = pointerId;
    });
    const hasPointerCapture = vi.fn(
      (pointerId: number) => capturedPointerId === pointerId,
    );
    const releasePointerCapture = vi.fn((pointerId: number) => {
      capturedPointerId = null;
      return pointerId;
    });
    Object.defineProperties(region, {
      setPointerCapture: { configurable: true, value: setPointerCapture },
      hasPointerCapture: { configurable: true, value: hasPointerCapture },
      releasePointerCapture: {
        configurable: true,
        value: releasePointerCapture,
      },
    });

    const pointerDown = new MouseEvent('pointerdown', {
      bubbles: true,
      button: 0,
      clientX: 200,
      clientY: 200,
    });
    Object.defineProperty(pointerDown, 'pointerId', { value: 9 });
    fireEvent(region, pointerDown);
    result.unmount();

    expect(setPointerCapture).toHaveBeenCalledWith(9);
    expect(releasePointerCapture).toHaveBeenCalledWith(9);
  });

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
});
