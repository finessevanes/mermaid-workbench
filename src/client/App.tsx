import { useEffect, useMemo, useState } from 'react';
import { DEFAULT_DIAGRAM_SOURCE } from '@shared/constants';
import type {
  DiagramRecord,
  LibraryBackupV1,
  LibraryIndex,
  ProjectRecord,
} from '@shared/types';
import { api, type WorkbenchApi } from './api';
import {
  diagramDeletionMessage,
  projectDeletionMessage,
} from './confirmations';
import { Dialog } from './components/Dialog';
import { EditorView } from './components/EditorView';
import { LibraryView } from './components/LibraryView';
import type { MermaidRenderer } from './use-mermaid-preview';

type ActiveDialog =
  | { type: 'create-project' }
  | { type: 'create-diagram'; projectId: string }
  | { type: 'rename-project'; project: ProjectRecord }
  | { type: 'delete-project'; project: ProjectRecord }
  | { type: 'delete-diagram'; diagram: DiagramRecord }
  | { type: 'restore-backup'; backup: LibraryBackupV1 }
  | null;

interface AppProps {
  client?: WorkbenchApi;
  renderDiagram?: MermaidRenderer;
  autosaveDelay?: number;
}

function NameFieldDialog({
  title,
  label,
  initialValue = '',
  confirmLabel,
  onConfirm,
  onClose,
}: {
  title: string;
  label: string;
  initialValue?: string;
  confirmLabel: string;
  onConfirm: (value: string) => void | Promise<void>;
  onClose: () => void;
}) {
  const [value, setValue] = useState(initialValue);
  return (
    <Dialog
      title={title}
      confirmLabel={confirmLabel}
      onClose={onClose}
      onConfirm={() => {
        const normalized = value.trim();
        if (normalized) {
          return onConfirm(normalized);
        }
      }}
    >
      <label className="field">
        <span>{label}</span>
        <input
          autoFocus
          required
          maxLength={120}
          value={value}
          onChange={(event) => setValue(event.currentTarget.value)}
        />
      </label>
    </Dialog>
  );
}

export function App({
  client = api,
  renderDiagram,
  autosaveDelay = 650,
}: AppProps) {
  const [library, setLibrary] = useState<LibraryIndex | null>(null);
  const [selectedDiagramId, setSelectedDiagramId] = useState<string | null>(
    null,
  );
  const [activeDialog, setActiveDialog] = useState<ActiveDialog>(null);
  const [error, setError] = useState<string | null>(null);

  const refreshLibrary = async () => {
    try {
      setLibrary(await client.listLibrary());
      setError(null);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'The local library could not be loaded.',
      );
    }
  };

  useEffect(() => {
    void refreshLibrary();
  }, [client]);

  const selectedDiagram = useMemo(
    () =>
      library?.diagrams.find(
        (diagram) => diagram.id === selectedDiagramId,
      ) ?? null,
    [library, selectedDiagramId],
  );
  const selectedProject =
    selectedDiagram && library
      ? library.projects.find(
          (project) => project.id === selectedDiagram.projectId,
        ) ?? null
      : null;

  const addProject = (project: ProjectRecord) => {
    setLibrary((current) =>
      current
        ? { ...current, projects: [...current.projects, project] }
        : { projects: [project], diagrams: [] },
    );
  };

  const addDiagram = (diagram: DiagramRecord) => {
    setLibrary((current) =>
      current
        ? { ...current, diagrams: [...current.diagrams, diagram] }
        : { projects: [], diagrams: [diagram] },
    );
  };

  const updateDiagram = (updated: DiagramRecord) => {
    setLibrary((current) =>
      current
        ? {
            ...current,
            diagrams: current.diagrams.map((diagram) =>
              diagram.id === updated.id ? updated : diagram,
            ),
          }
        : current,
    );
  };

  const runAction = async (action: () => Promise<void>) => {
    try {
      await action();
      setError(null);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'The action could not be completed.',
      );
    }
  };

  const importDiagram = (projectId: string, file: File) => {
    void runAction(async () => {
      const source = await file.text();
      const title = file.name.replace(/\.mmd$/i, '') || 'Imported diagram';
      const diagram = await client.createDiagram(projectId, title, source);
      addDiagram(diagram);
      setSelectedDiagramId(diagram.id);
    });
  };

  const prepareBackupRestore = (file: File) => {
    void runAction(async () => {
      const backup = JSON.parse(await file.text()) as LibraryBackupV1;
      if (
        backup.format !== 'mermaid-workbench-backup' ||
        backup.version !== 1 ||
        !Array.isArray(backup.projects) ||
        !Array.isArray(backup.diagrams)
      ) {
        throw new Error('The selected file is not a Mermaid Workbench backup.');
      }
      setActiveDialog({ type: 'restore-backup', backup });
    });
  };

  if (!library) {
    return (
      <main className="loading-screen">
        <div className="brand-mark" aria-hidden="true">
          M
        </div>
        <h1>Mermaid Workbench</h1>
        <p role="status">
          {error ?? 'Opening your local diagram library…'}
        </p>
        {error ? (
          <button
            type="button"
            className="button button--primary"
            onClick={() => void refreshLibrary()}
          >
            Retry
          </button>
        ) : null}
      </main>
    );
  }

  return (
    <>
      {error ? (
        <div className="global-error" role="alert">
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)}>
            Dismiss
          </button>
        </div>
      ) : null}

      {selectedDiagram && selectedProject ? (
        <EditorView
          diagram={selectedDiagram}
          project={selectedProject}
          client={client}
          renderDiagram={renderDiagram}
          autosaveDelay={autosaveDelay}
          onUpdated={updateDiagram}
          onBack={() => setSelectedDiagramId(null)}
          onDuplicate={() => {
            void runAction(async () => {
              const duplicate = await client.duplicateDiagram(
                selectedDiagram.id,
              );
              addDiagram(duplicate);
              setSelectedDiagramId(duplicate.id);
            });
          }}
          onDelete={() =>
            setActiveDialog({
              type: 'delete-diagram',
              diagram: selectedDiagram,
            })
          }
        />
      ) : (
        <LibraryView
          library={library}
          renderDiagram={renderDiagram}
          onCreateProject={() => setActiveDialog({ type: 'create-project' })}
          onCreateDiagram={(projectId) =>
            setActiveDialog({ type: 'create-diagram', projectId })
          }
          onOpenDiagram={setSelectedDiagramId}
          onRenameProject={(project) =>
            setActiveDialog({ type: 'rename-project', project })
          }
          onDeleteProject={(project) =>
            setActiveDialog({ type: 'delete-project', project })
          }
          onImportDiagram={importDiagram}
          onRestoreBackup={prepareBackupRestore}
        />
      )}

      {activeDialog?.type === 'create-project' ? (
        <NameFieldDialog
          title="Create a project"
          label="Project name"
          confirmLabel="Create project"
          onClose={() => setActiveDialog(null)}
          onConfirm={(name) =>
            runAction(async () => {
              addProject(await client.createProject(name));
              setActiveDialog(null);
            })
          }
        />
      ) : null}

      {activeDialog?.type === 'create-diagram' ? (
        <NameFieldDialog
          title="Create a diagram"
          label="Diagram title"
          confirmLabel="Create diagram"
          onClose={() => setActiveDialog(null)}
          onConfirm={(title) =>
            runAction(async () => {
              const created = await client.createDiagram(
                activeDialog.projectId,
                title,
                DEFAULT_DIAGRAM_SOURCE,
              );
              addDiagram(created);
              setSelectedDiagramId(created.id);
              setActiveDialog(null);
            })
          }
        />
      ) : null}

      {activeDialog?.type === 'rename-project' ? (
        <NameFieldDialog
          title={`Rename ${activeDialog.project.name}`}
          label="Project name"
          initialValue={activeDialog.project.name}
          confirmLabel="Rename project"
          onClose={() => setActiveDialog(null)}
          onConfirm={(name) =>
            runAction(async () => {
              const renamed = await client.renameProject(
                activeDialog.project.id,
                name,
              );
              setLibrary((current) => ({
                projects: current!.projects.map((project) =>
                  project.id === renamed.id ? renamed : project,
                ),
                diagrams: current!.diagrams,
              }));
              setActiveDialog(null);
            })
          }
        />
      ) : null}

      {activeDialog?.type === 'delete-project' ? (
        <Dialog
          title={`Delete ${activeDialog.project.name}`}
          description={projectDeletionMessage(
            activeDialog.project.name,
            library.diagrams.filter(
              (diagram) =>
                diagram.projectId === activeDialog.project.id,
            ).length,
          )}
          confirmLabel="Delete project"
          destructive
          onClose={() => setActiveDialog(null)}
          onConfirm={() =>
            runAction(async () => {
              await client.deleteProject(activeDialog.project.id);
              setLibrary((current) => ({
                projects: current!.projects.filter(
                  (project) => project.id !== activeDialog.project.id,
                ),
                diagrams: current!.diagrams.filter(
                  (diagram) =>
                    diagram.projectId !== activeDialog.project.id,
                ),
              }));
              setActiveDialog(null);
            })
          }
        />
      ) : null}

      {activeDialog?.type === 'delete-diagram' ? (
        <Dialog
          title={`Delete ${activeDialog.diagram.title}`}
          description={diagramDeletionMessage(activeDialog.diagram.title)}
          confirmLabel="Delete diagram"
          destructive
          onClose={() => setActiveDialog(null)}
          onConfirm={() =>
            runAction(async () => {
              await client.deleteDiagram(activeDialog.diagram.id);
              setLibrary((current) => ({
                projects: current!.projects,
                diagrams: current!.diagrams.filter(
                  (diagram) => diagram.id !== activeDialog.diagram.id,
                ),
              }));
              setSelectedDiagramId(null);
              setActiveDialog(null);
            })
          }
        />
      ) : null}

      {activeDialog?.type === 'restore-backup' ? (
        <Dialog
          title="Replace this library?"
          description={`Restore ${activeDialog.backup.projects.length} projects and ${activeDialog.backup.diagrams.length} diagrams. The current library will be replaced only if the complete backup is valid.`}
          confirmLabel="Replace library"
          destructive
          onClose={() => setActiveDialog(null)}
          onConfirm={() =>
            runAction(async () => {
              await client.restoreBackup(activeDialog.backup);
              setSelectedDiagramId(null);
              setActiveDialog(null);
              await refreshLibrary();
            })
          }
        />
      ) : null}
    </>
  );
}
