// @vitest-environment jsdom

import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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
    configurable: true,
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
