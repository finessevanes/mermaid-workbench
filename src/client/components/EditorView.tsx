import {
  useCallback,
  useEffect,
  useReducer,
  useRef,
  useState,
} from 'react';
import type {
  ConflictDetails,
  DiagramRecord,
  ProjectRecord,
} from '@shared/types';
import { ApiClientError, type WorkbenchApi } from '../api';
import {
  saveStateLabel,
  saveStateReducer,
} from '../save-state';
import {
  useMermaidPreview,
  type MermaidRenderer,
} from '../use-mermaid-preview';
import { Dialog } from './Dialog';

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
  version: number;
}

function isConflictDetails(value: unknown): value is ConflictDetails {
  if (!value || typeof value !== 'object') {
    return false;
  }
  return 'current' in value && 'submitted' in value;
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
  const [draft, setDraft] = useState<Draft>({
    title: diagram.title,
    source: diagram.source,
    version: diagram.version,
  });
  const [saveState, dispatchSave] = useReducer(saveStateReducer, {
    status: 'saved',
  });
  const [conflict, setConflict] = useState<ConflictDetails | null>(null);
  const pendingSave = useRef<Promise<void> | null>(null);
  const preview = useMermaidPreview(draft.source, renderDiagram);

  useEffect(() => {
    setDraft({
      title: diagram.title,
      source: diagram.source,
      version: diagram.version,
    });
    dispatchSave({ type: 'RESET' });
    setConflict(null);
  }, [diagram.id]);

  const save = useCallback(
    (options?: { forceVersion?: number }) => {
      const snapshot = { ...draft };
      dispatchSave({ type: 'SAVE_STARTED' });
      const operation = client
        .updateDiagram(diagram.id, {
          title: snapshot.title,
          source: snapshot.source,
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
    setDraft({
      title: conflict.current.title,
      source: conflict.current.source,
      version: conflict.current.version,
    });
    onUpdated(conflict.current);
    setConflict(null);
    dispatchSave({ type: 'RESET' });
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

        <div className="workspace-grid">
          <section className="workspace-panel workspace-panel--source">
            <div className="workspace-panel__header">
              <div>
                <span className="panel-index">01</span>
                <h2>Source</h2>
              </div>
              <span className="panel-hint">Mermaid syntax</span>
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

          <section
            className="workspace-panel workspace-panel--preview"
            aria-labelledby="preview-heading"
          >
            <div className="workspace-panel__header">
              <div>
                <span className="panel-index">02</span>
                <h2 id="preview-heading">Preview</h2>
              </div>
              <span className="panel-hint">
                {preview.rendering ? 'Rendering…' : 'Live'}
              </span>
            </div>
            <div className="editor-preview">
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
          </section>
        </div>
      </section>

      {conflict ? (
        <Dialog
          title="Choose which version to keep"
          description="Another request saved this diagram before your changes reached the local database. Review the choice carefully."
          confirmLabel="Keep my version"
          onClose={useSavedVersion}
          onConfirm={() => save({ forceVersion: conflict.current.version })}
        >
          <div className="conflict-grid">
            <div>
              <strong>Saved version</strong>
              <pre>{conflict.current.source}</pre>
            </div>
            <div>
              <strong>My version</strong>
              <pre>{draft.source}</pre>
            </div>
          </div>
          <button
            type="button"
            className="button button--quiet"
            onClick={useSavedVersion}
          >
            Use saved version
          </button>
        </Dialog>
      ) : null}
    </main>
  );
}
