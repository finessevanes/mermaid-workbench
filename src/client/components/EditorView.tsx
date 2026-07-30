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
  type SaveState,
  type SaveStateAction,
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
  const draftRef = useRef(draft);
  const saveStateRef = useRef<SaveState>({ status: 'saved' });
  const pendingSave = useRef<Promise<void> | null>(null);
  const editGenerationRef = useRef(0);
  const savedGenerationRef = useRef(0);
  const requestedSaveGenerationRef = useRef(0);
  const forceSaveOptionsRef = useRef<{ forceVersion: number } | null>(null);
  const presentationOperationRef = useRef(0);
  const activeDiagramIdRef = useRef(diagram.id);
  const collapseSourceRef = useRef<HTMLButtonElement>(null);
  const expandSourceRef = useRef<HTMLButtonElement>(null);
  const sourceFocusTargetRef = useRef<'collapse' | 'expand' | null>(null);
  const preview = useMermaidPreview(draft.source, renderDiagram);
  const previewRef = useRef({
    error: preview.error,
    rendering: preview.rendering,
  });
  previewRef.current = {
    error: preview.error,
    rendering: preview.rendering,
  };
  activeDiagramIdRef.current = diagram.id;

  const transitionSaveState = (action: SaveStateAction) => {
    saveStateRef.current = saveStateReducer(saveStateRef.current, action);
    dispatchSave(action);
  };

  const replaceDraft = (next: Draft) => {
    draftRef.current = next;
    setDraft(next);
  };

  const importPresentation = useCallback(
    (source: string, diagramId: string) => {
      const operation = ++presentationOperationRef.current;
      setPresentation({ mode: 'loading' });
      void importMermaidFlowchart(source).then((result) => {
        if (
          presentationOperationRef.current !== operation ||
          activeDiagramIdRef.current !== diagramId ||
          draftRef.current.source !== source
        ) {
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
          replaceDraft({ ...draftRef.current, canvas });
          setPresentation({ mode: 'interactive', canvas, transient: true });
        } catch {
          setPresentation({
            mode: 'static',
            reason: 'The flowchart could not be prepared for interactive layout.',
          });
        }
      });
    },
    [],
  );

  useEffect(() => {
    presentationOperationRef.current += 1;
    const nextCanvas = validatedCanvas(diagram.canvas);
    replaceDraft({
      title: diagram.title,
      source: diagram.source,
      canvas: nextCanvas.canvas,
      version: diagram.version,
    });
    editGenerationRef.current = 0;
    savedGenerationRef.current = 0;
    requestedSaveGenerationRef.current = 0;
    forceSaveOptionsRef.current = null;
    transitionSaveState({ type: 'RESET' });
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
      return;
    }

    if (nextCanvas.error) {
      setPresentation({ mode: 'static', reason: nextCanvas.error });
      return;
    }

    importPresentation(diagram.source, diagram.id);
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
      requestedSaveGenerationRef.current = Math.max(
        requestedSaveGenerationRef.current,
        editGenerationRef.current,
      );
      if (options?.forceVersion !== undefined) {
        forceSaveOptionsRef.current = {
          forceVersion: options.forceVersion,
        };
      }
      if (pendingSave.current) {
        return pendingSave.current;
      }

      const diagramId = diagram.id;
      const run = async () => {
        while (
          savedGenerationRef.current <
            requestedSaveGenerationRef.current ||
          forceSaveOptionsRef.current
        ) {
          const targetGeneration = editGenerationRef.current;
          const forceOptions = forceSaveOptionsRef.current;
          forceSaveOptionsRef.current = null;
          const snapshot = { ...draftRef.current };
          transitionSaveState({ type: 'SAVE_STARTED' });
          try {
            const updated = await client.updateDiagram(diagramId, {
              title: snapshot.title,
              source: snapshot.source,
              canvas: snapshot.canvas,
              version:
                forceOptions?.forceVersion ??
                snapshot.version,
              ...(forceOptions ? { force: true } : {}),
            });
            if (activeDiagramIdRef.current !== diagramId) {
              return;
            }
            savedGenerationRef.current = Math.max(
              savedGenerationRef.current,
              targetGeneration,
            );
            replaceDraft({
              ...draftRef.current,
              version: updated.version,
            });
            onUpdated(updated);
            setConflict(null);
            if (
              editGenerationRef.current === targetGeneration &&
              requestedSaveGenerationRef.current <= targetGeneration
            ) {
              transitionSaveState({ type: 'SAVE_SUCCEEDED' });
            } else {
              transitionSaveState({ type: 'EDITED' });
            }
          } catch (error: unknown) {
            if (
              error instanceof ApiClientError &&
              error.code === 'VERSION_CONFLICT' &&
              isConflictDetails(error.details)
            ) {
              setConflict(error.details);
            }
            transitionSaveState({
              type: 'SAVE_FAILED',
              message:
                error instanceof Error
                  ? error.message
                  : 'The diagram could not be saved.',
            });
            return;
          }
        }
      };
      const operation = run();
      const trackedOperation = operation.finally(() => {
        if (pendingSave.current === trackedOperation) {
          pendingSave.current = null;
        }
      });
      pendingSave.current = trackedOperation;
      return trackedOperation;
    },
    [client, diagram.id, onUpdated],
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
    const nextDraft = { ...draftRef.current, ...next };
    replaceDraft(nextDraft);
    editGenerationRef.current += 1;
    transitionSaveState({ type: 'EDITED' });
    if (next.source !== undefined) {
      presentationOperationRef.current += 1;
      if (presentation.mode === 'loading') {
        importPresentation(next.source, diagram.id);
      }
    }
  };

  const flushPendingChanges = async () => {
    while (true) {
      if (saveStateRef.current.status === 'failed') {
        return false;
      }
      if (
        editGenerationRef.current > savedGenerationRef.current &&
        !pendingSave.current
      ) {
        if (
          previewRef.current.error ||
          (
            previewRef.current.rendering &&
            draftRef.current.source !== diagram.source
          )
        ) {
          return false;
        }
        await save();
        continue;
      }
      const activeSave = pendingSave.current;
      if (activeSave) {
        requestedSaveGenerationRef.current = Math.max(
          requestedSaveGenerationRef.current,
          editGenerationRef.current,
        );
        await activeSave;
        continue;
      }
      return editGenerationRef.current <= savedGenerationRef.current;
    }
  };

  const confirmFlushedChanges = async () => {
    if (
      !(await flushPendingChanges()) &&
      !window.confirm(
        'This diagram has unsaved changes. Leave the editor anyway?',
      )
    ) {
      return false;
    }
    return true;
  };

  const handleBack = async () => {
    if (!(await confirmFlushedChanges())) {
      return;
    }
    onBack();
  };

  const handleDuplicate = async () => {
    if (!(await confirmFlushedChanges())) {
      return;
    }
    onDuplicate();
  };

  const useSavedVersion = () => {
    if (!conflict) {
      return;
    }
    presentationOperationRef.current += 1;
    const savedRecord = conflict.current;
    const savedCanvas = validatedCanvas(savedRecord.canvas);
    replaceDraft({
      title: savedRecord.title,
      source: savedRecord.source,
      canvas: savedCanvas.canvas,
      version: savedRecord.version,
    });
    editGenerationRef.current = 0;
    savedGenerationRef.current = 0;
    requestedSaveGenerationRef.current = 0;
    forceSaveOptionsRef.current = null;
    if (savedCanvas.canvas) {
      setPresentation({
        mode: 'interactive',
        canvas: savedCanvas.canvas,
        transient: false,
      });
    } else if (savedCanvas.error) {
      setPresentation({
        mode: 'static',
        reason: savedCanvas.error,
      });
    } else {
      importPresentation(savedRecord.source, savedRecord.id);
    }
    onUpdated(savedRecord);
    setConflict(null);
    transitionSaveState({ type: 'RESET' });
  };

  const updateCanvasLocally = (canvas: FlowchartCanvasV1) => {
    replaceDraft({ ...draftRef.current, canvas });
    setPresentation((current) => ({
      mode: 'interactive',
      canvas,
      transient: current.mode === 'interactive' && current.transient,
    }));
  };

  const commitCanvas = (canvas: FlowchartCanvasV1) => {
    replaceDraft({ ...draftRef.current, canvas });
    setPresentation({
      mode: 'interactive',
      canvas,
      transient: false,
    });
    editGenerationRef.current += 1;
    transitionSaveState({ type: 'EDITED' });
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
    const source = draftRef.current.source;
    const editGeneration = editGenerationRef.current;
    const operation = ++presentationOperationRef.current;
    const result = await importMermaidFlowchart(source);
    if (
      presentationOperationRef.current !== operation ||
      activeDiagramIdRef.current !== diagramId ||
      draftRef.current.source !== source ||
      editGenerationRef.current !== editGeneration ||
      result.status !== 'compatible'
    ) {
      return;
    }
    try {
      const canvas = validateFlowchartCanvas(
        layoutImportedFlowchart(result.graph),
      );
      replaceDraft({ ...draftRef.current, canvas });
      setPresentation({
        mode: 'interactive',
        canvas,
        transient: false,
      });
      setCanvasFitRevision((current) => current + 1);
      editGenerationRef.current += 1;
      transitionSaveState({ type: 'EDITED' });
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
              onClick={() => void handleDuplicate()}
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
