// @vitest-environment jsdom

import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  useMermaidPreview,
  type MermaidRenderer,
} from './use-mermaid-preview';

function PreviewHarness({
  source,
  renderDiagram,
}: {
  source: string;
  renderDiagram: MermaidRenderer;
}) {
  const preview = useMermaidPreview(source, renderDiagram);
  return (
    <>
      <output data-testid="svg">{preview.svg}</output>
      <output data-testid="error">{preview.error ?? ''}</output>
      <output data-testid="rendering">{String(preview.rendering)}</output>
    </>
  );
}

describe('useMermaidPreview', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders valid source after the preview debounce', async () => {
    vi.useFakeTimers();
    const renderer: MermaidRenderer = async (source) =>
      `<svg aria-label="diagram">${source}</svg>`;
    render(
      <PreviewHarness
        source={'flowchart LR\n  Idea --> Ship'}
        renderDiagram={renderer}
      />,
    );

    expect(screen.getByTestId('rendering')).toHaveTextContent('true');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(220);
    });

    expect(screen.getByTestId('svg')).toHaveTextContent(
      'flowchart LR Idea --> Ship',
    );
    expect(screen.getByTestId('error')).toBeEmptyDOMElement();
    expect(screen.getByTestId('rendering')).toHaveTextContent('false');
  });

  it('retains the last valid SVG when the next source is invalid', async () => {
    vi.useFakeTimers();
    const renderer: MermaidRenderer = async (source) => {
      if (source.includes('broken')) {
        throw new Error('Parse error near broken');
      }
      return `<svg aria-label="diagram">${source}</svg>`;
    };
    const view = render(
      <PreviewHarness
        source={'flowchart LR\n  A --> B'}
        renderDiagram={renderer}
      />,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(220);
    });
    const lastValid = screen.getByTestId('svg').textContent;

    view.rerender(
      <PreviewHarness
        source={'flowchart LR\n  A --> broken['}
        renderDiagram={renderer}
      />,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(220);
    });

    expect(screen.getByTestId('svg').textContent).toBe(lastValid);
    expect(screen.getByTestId('error')).toHaveTextContent(
      'Parse error near broken',
    );
  });

  it('ignores a stale render that finishes after newer source', async () => {
    vi.useFakeTimers();
    let finishSlowRender: ((svg: string) => void) | undefined;
    const renderer: MermaidRenderer = (source) => {
      if (source === 'slow') {
        return new Promise((resolve) => {
          finishSlowRender = resolve;
        });
      }
      return Promise.resolve(`<svg>${source}</svg>`);
    };
    const view = render(
      <PreviewHarness source="slow" renderDiagram={renderer} />,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(220);
    });
    view.rerender(
      <PreviewHarness source="newest" renderDiagram={renderer} />,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(220);
    });
    expect(screen.getByTestId('svg')).toHaveTextContent('newest');

    await act(async () => {
      finishSlowRender?.('<svg>stale</svg>');
      await Promise.resolve();
    });
    expect(screen.getByTestId('svg')).toHaveTextContent('newest');
  });
});
