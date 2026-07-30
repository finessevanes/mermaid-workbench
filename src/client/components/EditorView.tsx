import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useReducer,
  useRef,
  useState,
} from 'react';
import type {
  ConflictDetails,
  DiagramRecord,
  ProjectRecord,
} from '@shared/types';
import {
  validateFlowchartCanvas,
  type FlowchartCanvasV1,
} from '@shared/flowchart-canvas-schema';
import { ApiClientError, type WorkbenchApi } from '../api';
import { importMermaidFlowchart } from '../flowchart-import';
import { layoutImportedFlowchart } from '../flowchart-layout';
import {
  saveStateLabel,
  saveStateReducer,
} from '../save-state';
import {
  useMermaidPreview,
  type MermaidRenderer,
} from '../use-mermaid-preview';
import { Dialog } from './Dialog';
import { FlowchartCanvas } from './FlowchartCanvas';
import { PreviewViewport } from './PreviewViewport';

interface EditorViewProps {
  diagram: DiagramRecord;
  project: ProjectRecord;
  client: WorkbenchApi;
  renderDiagram?: MermaidRenderer;
  autosaveDelay: number;
  onUpdated: (diagram: DiagramRecord) => void;
  onBack: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}

interface Draft {
  title: string;
  source: string;
  canvas: FlowchartCanvasV1 | null;
  version: number;
}

type DiagramPresentation =
  | { mode: 'loading' }
  | { mode: 'interactive'; canvas: FlowchartCanvasV1; transient: boolean }
  | { mode: 'static'; reason: string };

function isConflictDetails(value: unknown): value is ConflictDetails {
  if (!value || typeof value !== 'object') {
    return false;
  }
  return 'current' in value && 'submitted' in value;
}

function validatedCanvas(
  canvas: FlowchartCanvasV1 | null,
): { canvas: FlowchartCanvasV1 | null; error: string | null } {
  if (canvas === null) {
    return { canvas: null, error: null };
  }
  try {
    return { canvas: validateFlowchartCanvas(canvas), error: null };
  } catch {
    return {
      canvas: null,
      error: 'The saved interactive layout is invalid. The Mermaid preview remains available.',
    };
  }
}

function canvasSummary(canvas: FlowchartCanvasV1 | null) {
  return canvas
    ? `${canvas.nodes.length} nodes · ${canvas.edges.length} edges`
    : 'No interactive layout';
}

export function EditorView({
  diagram,
  project,
  client,
  renderDiagram,
  autosaveDelay,
  onUpdated,
  onBack,
  onDuplicate,
  onDelete,
}: EditorViewProps) {
  const initialCanvas = validatedCanvas(diagram.canvas);
  const [draft, setDraft] = useState<Draft>({
    title: diagram.title,
    source: diagram.source,
    canvas: initialCanvas.canvas,
    version: diagram.version,
  });
  const [presentation, setPresentation] = useState<DiagramPresentation>(
    initialCanvas.canvas
      ? {
        mode: 'interactive',
        canvas: initialCanvas.canvas,
        transient: false,
      }
      : initialCanvas.error
        ? { mode: 'static', reason: initialCanvas.error }
        : { mode: 'loading' },
  );
  const [saveState, dispatchSave] = useReducer(saveStateReducer, {
    status: 'saved',
  });
  const [conflict, setConflict] = useState<ConflictDetails | null>(null);
  const [sourceCollapsed, setSourceCollapsed] = useState(false);
  const [sourceLayoutRevision, setSourceLayoutRevision] = useState(0);
  const [canvasFitRevision, setCanvasFitRevision] = useState(0);
  const pendingSave = useRef<Promise<void> | null>(null);
  const activeDiagramIdRef = useRef(diagram.id);
  const collapseSourceRef = useRef<HTMLButtonElement>(null);
  const expandSourceRef = useRef<HTMLButtonElement>(null);
  const sourceFocusTargetRef = useRef<'collapse' | 'expand' | null>(null);
  const preview = useMermaidPreview(draft.source, renderDiagram);

  useEffect(() => {
    activeDiagramIdRef.current = diagram.id;
    let active = true;
    const nextCanvas = validatedCanvas(diagram.canvas);
    setDraft({
      title: diagram.title,
      source: diagram.source,
      canvas: nextCanvas.canvas,
      version: diagram.version,
    });
    dispatchSave({ type: 'RESET' });
    setConflict(null);
    setSourceCollapsed(false);
    setSourceLayoutRevision(0);
    setCanvasFitRevision(0);

    if (nextCanvas.canvas) {
      setPresentation({
        mode: 'interactive',
        canvas: nextCanvas.canvas,
        transient: false,
      });
      return () => {
        active = false;
      };
    }

    if (nextCanvas.error) {
      setPresentation({ mode: 'static', reason: nextCanvas.error });
      return () => {
        active = false;
      };
    }

    setPresentation({ mode: 'loading' });
    void importMermaidFlowchart(diagram.source).then((result) => {
      if (!active) {
        return;
      }
      if (result.status === 'unsupported') {
        setPresentation({ mode: 'static', reason: result.reason });
        return;
      }
      try {
        const canvas = validateFlowchartCanvas(
          layoutImportedFlowchart(result.graph),
        );
        setDraft((current) => ({ ...current, canvas }));
        setPresentation({ mode: 'interactive', canvas, transient: true });
      } catch {
        setPresentation({
          mode: 'static',
          reason: 'The flowchart could not be prepared for interactive layout.',
        });
      }
    });

    return () => {
      active = false;
    };
  }, [diagram.id]);

  const collapseSource = () => {
    sourceFocusTargetRef.current = 'expand';
    setSourceLayoutRevision((current) => current + 1);
    setSourceCollapsed(true);
    window.requestAnimationFrame(() => expandSourceRef.current?.focus());
  };

  const expandSource = () => {
    sourceFocusTargetRef.current = 'collapse';
    setSourceLayoutRevision((current) => current + 1);
    setSourceCollapsed(false);
    window.requestAnimationFrame(() => collapseSourceRef.current?.focus());
  };

  useLayoutEffect(() => {
    const focusTarget = sourceFocusTargetRef.current;
    if (focusTarget === 'expand') {
      expandSourceRef.current?.focus();
    } else if (focusTarget === 'collapse') {
      collapseSourceRef.current?.focus();
    }
    sourceFocusTargetRef.current = null;
  }, [sourceCollapsed]);

  const save = useCallback(
    (options?: { forceVersion?: number }) => {
      const snapshot = { ...draft };
      dispatchSave({ type: 'SAVE_STARTED' });
      const operation = client
        .updateDiagram(diagram.id, {
          title: snapshot.title,
          source: snapshot.source,
          canvas: snapshot.canvas,
          version: options?.forceVersion ?? snapshot.version,
          ...(options ? { force: true } : {}),
        })
        .then((updated) => {
          setDraft((current) => ({
            ...current,
            version: updated.version,
          }));
          onUpdated(updated);
          setConflict(null);
          dispatchSave({ type: 'SAVE_SUCCEEDED' });
        })
        .catch((error: unknown) => {
          if (
            error instanceof ApiClientError &&
            error.code === 'VERSION_CONFLICT' &&
            isConflictDetails(error.details)
          ) {
            setConflict(error.details);
          }
          dispatchSave({
            type: 'SAVE_FAILED',
            message:
              error instanceof Error
                ? error.message
                : 'The diagram could not be saved.',
          });
        })
        .finally(() => {
          pendingSave.current = null;
        });
      pendingSave.current = operation;
      return operation;
    },
    [client, diagram.id, draft, onUpdated],
  );

  useEffect(() => {
    if (
      saveState.status !== 'dirty' ||
      preview.rendering ||
      preview.error
    ) {
      return;
    }
    const timeout = window.setTimeout(() => {
      void save();
    }, autosaveDelay);
    return () => window.clearTimeout(timeout);
  }, [
    autosaveDelay,
    preview.error,
    preview.rendering,
    save,
    saveState.status,
  ]);

  const updateDraft = (next: Partial<Pick<Draft, 'title' | 'source'>>) => {
    setDraft((current) => ({ ...current, ...next }));
    dispatchSave({ type: 'EDITED' });
  };

  const handleBack = async () => {
    if (pendingSave.current) {
      await pendingSave.current;
    }
    if (
      saveState.status === 'failed' &&
      !window.confirm('This diagram has unsaved changes. Leave the editor anyway?')
    ) {
      return;
    }
    onBack();
  };

  const useSavedVersion = () => {
    if (!conflict) {
      return;
    }
    const savedCanvas = validatedCanvas(conflict.current.canvas);
    setDraft({
      title: conflict.current.title,
      source: conflict.current.source,
      canvas: savedCanvas.canvas,
      version: conflict.current.version,
    });
    if (savedCanvas.canvas) {
      setPresentation({
        mode: 'interactive',
        canvas: savedCanvas.canvas,
        transient: false,
      });
    } else {
      setPresentation({
        mode: 'static',
        reason:
          savedCanvas.error ??
          'This saved version has no interactive layout.',
      });
    }
    onUpdated(conflict.current);
    setConflict(null);
    dispatchSave({ type: 'RESET' });
  };

  const updateCanvasLocally = (canvas: FlowchartCanvasV1) => {
    setDraft((current) => ({ ...current, canvas }));
    setPresentation((current) => ({
      mode: 'interactive',
      canvas,
      transient: current.mode === 'interactive' && current.transient,
    }));
  };

  const commitCanvas = (canvas: FlowchartCanvasV1) => {
    setDraft((current) => ({ ...current, canvas }));
    setPresentation({
      mode: 'interactive',
      canvas,
      transient: false,
    });
    dispatchSave({ type: 'EDITED' });
  };

  const resetLayout = async () => {
    if (
      !window.confirm(
        'Reset all manually positioned nodes to an automatic layout?',
      )
    ) {
      return;
    }
    const diagramId = diagram.id;
    const result = await importMermaidFlowchart(draft.source);
    if (
      activeDiagramIdRef.current !== diagramId ||
      result.status !== 'compatible'
    ) {
      return;
    }
    try {
      const canvas = validateFlowchartCanvas(
        layoutImportedFlowchart(result.graph),
      );
      setDraft((current) => ({ ...current, canvas }));
      setPresentation({
        mode: 'interactive',
        canvas,
        transient: false,
      });
      setCanvasFitRevision((current) => current + 1);
      dispatchSave({ type: 'EDITED' });
    } catch {
      // Keep the current canvas intact when import or layout validation fails.
    }
  };

  return (
    <main className="editor-shell">
      <aside className="editor-rail" aria-label="Diagram navigation">
        <button
          type="button"
          className="back-button"
          onClick={() => void handleBack()}
        >
          <span aria-hidden="true">←</span>
          Library
        </button>
        <div className="editor-rail__identity">
          <span className="brand-mark brand-mark--small" aria-hidden="true">
            M
          </span>
          <span>Mermaid Workbench</span>
        </div>
        <div className="editor-rail__context">
          <span>Project</span>
          <strong>{project.name}</strong>
        </div>
        <div className="editor-rail__note">
          <span className="status-dot" aria-hidden="true" />
          Stored locally
        </div>
      </aside>

      <section className="editor-content">
        <header className="editor-header">
          <div className="editor-header__title">
            <p className="eyebrow">{project.name}</p>
            <h1>{draft.title}</h1>
          </div>
          <div className="editor-header__actions">
            <div
              className={`save-state save-state--${saveState.status}`}
              role="status"
              aria-label="Save status"
              aria-live="polite"
            >
              <span aria-hidden="true" />
              {saveStateLabel(saveState)}
            </div>
            {saveState.status === 'failed' && !conflict ? (
              <button
                type="button"
                className="button button--warning"
                onClick={() => void save()}
              >
                Retry save
              </button>
            ) : null}
            <a
              className="button button--quiet"
              href={client.exportDiagramUrl(diagram.id)}
              download
            >
              Export .mmd
            </a>
            <button
              type="button"
              className="button button--quiet"
              onClick={onDuplicate}
            >
              Duplicate
            </button>
            <button
              type="button"
              className="button button--danger-quiet"
              onClick={onDelete}
            >
              Delete
            </button>
          </div>
        </header>

        <div
          className={`workspace-grid${sourceCollapsed ? ' workspace-grid--source-collapsed' : ''}`}
        >
          {sourceCollapsed ? (
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
          ) : (
            <section className="workspace-panel workspace-panel--source">
              <div className="workspace-panel__header">
                <div>
                  <span className="panel-index">01</span>
                  <h2>Source</h2>
                </div>
                <div className="source-header__actions">
                  <span className="panel-hint">Mermaid syntax</span>
                  <button
                    ref={collapseSourceRef}
                    type="button"
                    className="icon-button source-collapse-button"
                    aria-label="Collapse source"
                    onClick={collapseSource}
                  >
                    <span aria-hidden="true">‹</span>
                  </button>
                </div>
              </div>
              <div className="source-fields">
                <label>
                  <span>Diagram title</span>
                  <input
                    value={draft.title}
                    maxLength={120}
                    onChange={(event) =>
                      updateDraft({ title: event.currentTarget.value })
                    }
                  />
                </label>
                <label className="source-editor">
                  <span>Mermaid source</span>
                  <textarea
                    value={draft.source}
                    spellCheck={false}
                    onChange={(event) =>
                      updateDraft({ source: event.currentTarget.value })
                    }
                  />
                </label>
              </div>
              <footer className="source-footer">
                <span>{draft.source.split('\n').length} lines</span>
                <span>{draft.source.length.toLocaleString()} characters</span>
              </footer>
            </section>
          )}

          {presentation.mode === 'interactive' ? (
            <section className="workspace-panel workspace-panel--canvas">
              <header className="preview-header">
                <div>
                  <span className="panel-index">02</span>
                  <h2>Preview</h2>
                </div>
              </header>
              <FlowchartCanvas
                key={diagram.id}
                canvas={presentation.canvas}
                sourceLayoutRevision={canvasFitRevision}
                onCanvasChange={updateCanvasLocally}
                onCommit={commitCanvas}
                onResetLayout={() => void resetLayout()}
              />
            </section>
          ) : presentation.mode === 'static' ? (
            <div className="workspace-preview-column">
              <div className="interactive-unavailable">
                <strong>Interactive layout unavailable</strong>
                <span>{presentation.reason}</span>
              </div>
              <PreviewViewport
                key={diagram.id}
                svg={preview.svg}
                rendering={preview.rendering}
                error={preview.error}
                sourceLayoutRevision={sourceLayoutRevision}
              />
            </div>
          ) : (
            <section
              className="workspace-panel workspace-panel--canvas-loading"
              aria-label="Preparing diagram"
            >
              <p role="status">Preparing interactive layout…</p>
            </section>
          )}
        </div>
      </section>

      {conflict ? (
        <Dialog
          title="Choose which version to keep"
          description="Another request saved this diagram before your changes reached the local database. Review the choice carefully."
          confirmLabel="Keep my version"
          closeLabel="Use saved version"
          onClose={useSavedVersion}
          onConfirm={() => save({ forceVersion: conflict.current.version })}
        >
          <div className="conflict-grid">
            <div>
              <strong>Saved version</strong>
              <pre>{conflict.current.source}</pre>
              <span>{canvasSummary(conflict.current.canvas)}</span>
            </div>
            <div>
              <strong>My version</strong>
              <pre>{draft.source}</pre>
              <span>{canvasSummary(draft.canvas)}</span>
            </div>
          </div>
        </Dialog>
      ) : null}
    </main>
  );
}
