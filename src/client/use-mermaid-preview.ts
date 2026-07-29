import { useEffect, useRef, useState } from 'react';

export interface MermaidPreviewState {
  svg: string;
  error: string | null;
  rendering: boolean;
}

export type MermaidRenderer = (
  source: string,
  renderId: string,
) => Promise<string>;

let mermaidInitialized = false;

export const defaultMermaidRenderer: MermaidRenderer = async (
  source,
  renderId,
) => {
  if (source.trim().length === 0) {
    throw new Error('Mermaid source cannot be empty.');
  }
  const { default: mermaid } = await import('mermaid');
  if (!mermaidInitialized) {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: 'base',
      themeVariables: {
        primaryColor: '#e9efff',
        primaryBorderColor: '#2f5ee5',
        primaryTextColor: '#111a2d',
        lineColor: '#526078',
        secondaryColor: '#fff4d6',
        tertiaryColor: '#f4f6fa',
        fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
      },
    });
    mermaidInitialized = true;
  }
  const result = await mermaid.render(renderId, source);
  return result.svg;
};

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export function useMermaidPreview(
  source: string,
  renderDiagram: MermaidRenderer = defaultMermaidRenderer,
): MermaidPreviewState {
  const [state, setState] = useState<MermaidPreviewState>({
    svg: '',
    error: null,
    rendering: true,
  });
  const requestSequence = useRef(0);
  const renderSequence = useRef(0);

  useEffect(() => {
    const requestId = ++requestSequence.current;
    setState((current) => ({ ...current, rendering: true }));
    const timeout = window.setTimeout(() => {
      const renderId = `mermaid-workbench-${++renderSequence.current}`;
      void renderDiagram(source, renderId)
        .then((svg) => {
          if (requestSequence.current !== requestId) {
            return;
          }
          setState({ svg, error: null, rendering: false });
        })
        .catch((error: unknown) => {
          if (requestSequence.current !== requestId) {
            return;
          }
          setState((current) => ({
            ...current,
            error: errorMessage(error),
            rendering: false,
          }));
        });
    }, 220);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [renderDiagram, source]);

  return state;
}
