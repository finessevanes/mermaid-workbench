import type { MermaidRenderer } from '../use-mermaid-preview';
import { useMermaidPreview } from '../use-mermaid-preview';

interface MermaidPreviewProps {
  source: string;
  renderDiagram?: MermaidRenderer;
  compact?: boolean;
  labelledBy?: string;
}

export function MermaidPreview({
  source,
  renderDiagram,
  compact = false,
  labelledBy,
}: MermaidPreviewProps) {
  const preview = useMermaidPreview(source, renderDiagram);

  return (
    <div
      className={`preview ${compact ? 'preview--compact' : ''}`}
      aria-labelledby={labelledBy}
    >
      {preview.rendering && preview.svg.length === 0 ? (
        <div className="preview__loading">Rendering diagram…</div>
      ) : null}
      <div
        className="preview__canvas"
        data-testid="mermaid-preview"
        dangerouslySetInnerHTML={{ __html: preview.svg }}
      />
      <div className="preview__error" role="alert" aria-live="assertive">
        {preview.error ? (
          <>
            <strong>Mermaid syntax error</strong>
            <span>{preview.error}</span>
          </>
        ) : null}
      </div>
    </div>
  );
}
