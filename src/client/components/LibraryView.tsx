import type {
  DiagramRecord,
  LibraryIndex,
  ProjectRecord,
} from '@shared/types';
import type { MermaidRenderer } from '../use-mermaid-preview';
import { MermaidPreview } from './MermaidPreview';

interface LibraryViewProps {
  library: LibraryIndex;
  renderDiagram?: MermaidRenderer;
  onCreateProject: () => void;
  onCreateDiagram: (projectId: string) => void;
  onOpenDiagram: (diagramId: string) => void;
  onRenameProject: (project: ProjectRecord) => void;
  onDeleteProject: (project: ProjectRecord) => void;
  onImportDiagram: (projectId: string, file: File) => void;
  onRestoreBackup: (file: File) => void;
}

function readableDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(value));
}

function ProjectSection({
  project,
  diagrams,
  renderDiagram,
  onCreateDiagram,
  onOpenDiagram,
  onRenameProject,
  onDeleteProject,
  onImportDiagram,
}: {
  project: ProjectRecord;
  diagrams: DiagramRecord[];
  renderDiagram?: MermaidRenderer;
  onCreateDiagram: (projectId: string) => void;
  onOpenDiagram: (diagramId: string) => void;
  onRenameProject: (project: ProjectRecord) => void;
  onDeleteProject: (project: ProjectRecord) => void;
  onImportDiagram: (projectId: string, file: File) => void;
}) {
  return (
    <section className="project-section" aria-labelledby={`project-${project.id}`}>
      <header className="project-section__header">
        <div>
          <p className="eyebrow">
            {diagrams.length} {diagrams.length === 1 ? 'diagram' : 'diagrams'}
          </p>
          <h2 id={`project-${project.id}`}>{project.name}</h2>
        </div>
        <div className="cluster">
          {diagrams.length > 0 ? (
            <button
              type="button"
              className="button button--primary"
              onClick={() => onCreateDiagram(project.id)}
            >
              New diagram
            </button>
          ) : null}
          <label className="button button--quiet file-action">
            Import .mmd
            <input
              type="file"
              accept=".mmd,text/plain"
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                if (file) {
                  onImportDiagram(project.id, file);
                  event.currentTarget.value = '';
                }
              }}
            />
          </label>
          <button
            type="button"
            className="icon-button"
            aria-label={`Rename ${project.name}`}
            onClick={() => onRenameProject(project)}
          >
            Rename
          </button>
          <button
            type="button"
            className="icon-button icon-button--danger"
            aria-label={`Delete ${project.name}`}
            onClick={() => onDeleteProject(project)}
          >
            Delete
          </button>
        </div>
      </header>

      {diagrams.length === 0 ? (
        <div className="project-empty">
          <div className="project-empty__mark" aria-hidden="true">
            ∿
          </div>
          <div>
            <h3>This project is ready for its first diagram.</h3>
            <p>Create one from a starter flowchart or import an existing .mmd file.</p>
          </div>
          <button
            type="button"
            className="button button--secondary"
            onClick={() => onCreateDiagram(project.id)}
          >
            New diagram
          </button>
        </div>
      ) : (
        <div className="diagram-grid">
          {diagrams.map((diagram) => (
            <article className="diagram-card" key={diagram.id}>
              <button
                type="button"
                className="diagram-card__open"
                aria-label={`Open ${diagram.title}`}
                onClick={() => onOpenDiagram(diagram.id)}
              >
                <MermaidPreview
                  source={diagram.source}
                  renderDiagram={renderDiagram}
                  compact
                  labelledBy={`diagram-title-${diagram.id}`}
                />
                <span className="diagram-card__meta">
                  <strong id={`diagram-title-${diagram.id}`}>{diagram.title}</strong>
                  <span>
                    Updated{' '}
                    <time dateTime={diagram.updatedAt}>
                      {readableDate(diagram.updatedAt)}
                    </time>
                  </span>
                </span>
              </button>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

export function LibraryView({
  library,
  renderDiagram,
  onCreateProject,
  onCreateDiagram,
  onOpenDiagram,
  onRenameProject,
  onDeleteProject,
  onImportDiagram,
  onRestoreBackup,
}: LibraryViewProps) {
  return (
    <main className="library-shell">
      <header className="library-hero">
        <div className="brand-lockup" aria-label="Mermaid Workbench">
          <span className="brand-mark" aria-hidden="true">
            M
          </span>
          <span>Mermaid Workbench</span>
        </div>
        <div className="library-hero__actions">
          <a className="button button--quiet" href="/api/backup" download>
            Export backup
          </a>
          <label className="button button--quiet file-action">
            Restore backup
            <input
              type="file"
              accept=".json,application/json"
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                if (file) {
                  onRestoreBackup(file);
                  event.currentTarget.value = '';
                }
              }}
            />
          </label>
          <button
            type="button"
            className="button button--primary"
            onClick={onCreateProject}
          >
            New project
          </button>
        </div>
      </header>

      {library.projects.length === 0 ? (
        <section className="library-empty">
          <div className="library-empty__graphic" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <p className="eyebrow">Your private diagram library</p>
          <h1>Give every idea a place to connect.</h1>
          <p>
            Projects keep related Mermaid diagrams together. Everything stays on
            this computer and saves automatically.
          </p>
          <div className="cluster cluster--centered">
            <button
              type="button"
              className="button button--primary button--large"
              onClick={onCreateProject}
            >
              Create your first project
            </button>
            <label className="button button--quiet button--large file-action">
              Restore backup
              <input
                type="file"
                accept=".json,application/json"
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0];
                  if (file) {
                    onRestoreBackup(file);
                    event.currentTarget.value = '';
                  }
                }}
              />
            </label>
          </div>
        </section>
      ) : (
        <div className="library-content">
          <div className="library-intro">
            <div>
              <p className="eyebrow">Local library</p>
              <h1>Your diagrams, organized.</h1>
            </div>
            <p>
              {library.projects.length}{' '}
              {library.projects.length === 1 ? 'project' : 'projects'} ·{' '}
              {library.diagrams.length}{' '}
              {library.diagrams.length === 1 ? 'diagram' : 'diagrams'}
            </p>
          </div>
          {library.projects.map((project) => (
            <ProjectSection
              key={project.id}
              project={project}
              diagrams={library.diagrams.filter(
                (diagram) => diagram.projectId === project.id,
              )}
              renderDiagram={renderDiagram}
              onCreateDiagram={onCreateDiagram}
              onOpenDiagram={onOpenDiagram}
              onRenameProject={onRenameProject}
              onDeleteProject={onDeleteProject}
              onImportDiagram={onImportDiagram}
            />
          ))}
        </div>
      )}
    </main>
  );
}
