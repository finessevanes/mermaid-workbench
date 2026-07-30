import { useEffect, useRef, useState } from 'react';
import { getMermaid } from './mermaid-runtime';

export interface MermaidPreviewState {
  svg: string;
  error: string | null;
  rendering: boolean;
}

export type MermaidRenderer = (
  source: string,
  renderId: string,
) => Promise<string>;

export const defaultMermaidRenderer: MermaidRenderer = async (
  source,
  renderId,
) => {
  if (source.trim().length === 0) {
    throw new Error('Mermaid source cannot be empty.');
  }
  const mermaid = await getMermaid();
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
