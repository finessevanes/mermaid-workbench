import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import type {
  DiagramRecord,
  LibraryBackup,
  LibraryBackupV2,
  LibraryIndex,
  ProjectRecord,
} from '@shared/types';
import {
  validateFlowchartCanvas,
  type FlowchartCanvasV1,
} from '@shared/flowchart-canvas-schema';
import {
  backupSchema,
  diagramInputSchema,
  diagramUpdateSchema,
  projectInputSchema,
} from './schemas';
import { ensureDatabaseDirectory } from './app-paths';

interface ProjectRow {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

interface DiagramRow {
  id: string;
  project_id: string;
  title: string;
  source: string;
  canvas_json: string | null;
  version: number;
  created_at: string;
  updated_at: string;
}

export class RecordNotFoundError extends Error {
  constructor(
    public readonly resource: 'project' | 'diagram',
    public readonly id: string,
  ) {
    super(`${resource === 'project' ? 'Project' : 'Diagram'} not found.`);
    this.name = 'RecordNotFoundError';
  }
}

export class VersionConflictError extends Error {
  constructor(
    public readonly current: DiagramRecord,
    public readonly submitted: DiagramRecord,
  ) {
    super('This diagram was updated by another request.');
    this.name = 'VersionConflictError';
  }
}

export class InvalidBackupError extends Error {
  constructor(
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'InvalidBackupError';
  }
}

function toProject(row: ProjectRow): ProjectRecord {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toDiagram(row: DiagramRow): DiagramRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    source: row.source,
    canvas:
      row.canvas_json === null
        ? null
        : validateFlowchartCanvas(JSON.parse(row.canvas_json)),
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function assertUniqueIds(
  records: Array<{ id: string }>,
  recordType: string,
): void {
  const ids = new Set<string>();
  for (const record of records) {
    if (ids.has(record.id)) {
      throw new InvalidBackupError(
        `The backup contains a duplicate ${recordType} identifier.`,
      );
    }
    ids.add(record.id);
  }
}

export class WorkbenchStore {
  private readonly database: DatabaseSync;

  constructor(databasePath: string) {
    ensureDatabaseDirectory(databasePath);
    this.database = new DatabaseSync(databasePath);
    this.database.exec('PRAGMA foreign_keys = ON;');
    this.database.exec('PRAGMA journal_mode = WAL;');
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS diagrams (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        source TEXT NOT NULL,
        version INTEGER NOT NULL CHECK (version > 0),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE INDEX IF NOT EXISTS diagrams_project_id
      ON diagrams(project_id);
    `);
    const diagramColumns = this.database
      .prepare('PRAGMA table_info(diagrams)')
      .all() as Array<{ name: string }>;
    if (!diagramColumns.some((column) => column.name === 'canvas_json')) {
      this.database.exec('ALTER TABLE diagrams ADD COLUMN canvas_json TEXT;');
    }
  }

  close(): void {
    this.database.close();
  }

  listLibrary(): LibraryIndex {
    const projectRows = this.database
      .prepare(
        `SELECT id, name, created_at, updated_at
         FROM projects
         ORDER BY rowid ASC`,
      )
      .all() as unknown as ProjectRow[];
    const diagramRows = this.database
      .prepare(
        `SELECT id, project_id, title, source, canvas_json, version, created_at, updated_at
         FROM diagrams
         ORDER BY rowid ASC`,
      )
      .all() as unknown as DiagramRow[];
    return {
      projects: projectRows.map(toProject),
      diagrams: diagramRows.map(toDiagram),
    };
  }

  createProject(input: { name: string }): ProjectRecord {
    const parsed = projectInputSchema.parse(input);
    const timestamp = new Date().toISOString();
    const project: ProjectRecord = {
      id: randomUUID(),
      name: parsed.name,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.database
      .prepare(
        `INSERT INTO projects (id, name, created_at, updated_at)
         VALUES (?, ?, ?, ?)`,
      )
      .run(
        project.id,
        project.name,
        project.createdAt,
        project.updatedAt,
      );
    return project;
  }

  renameProject(id: string, input: { name: string }): ProjectRecord {
    const parsed = projectInputSchema.parse(input);
    const updatedAt = new Date().toISOString();
    const result = this.database
      .prepare(
        `UPDATE projects
         SET name = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(parsed.name, updatedAt, id);
    if (result.changes === 0) {
      throw new RecordNotFoundError('project', id);
    }
    return this.getProject(id);
  }

  deleteProject(id: string): {
    deletedProjectId: string;
    deletedDiagramCount: number;
  } {
    this.getProject(id);
    const countRow = this.database
      .prepare(
        `SELECT COUNT(*) AS count
         FROM diagrams
         WHERE project_id = ?`,
      )
      .get(id) as { count: number };
    this.database.prepare('DELETE FROM projects WHERE id = ?').run(id);
    return {
      deletedProjectId: id,
      deletedDiagramCount: Number(countRow.count),
    };
  }

  createDiagram(input: {
    projectId: string;
    title: string;
    source: string;
  }): DiagramRecord {
    const parsed = diagramInputSchema.parse(input);
    this.getProject(parsed.projectId);
    return this.insertDiagram(parsed);
  }

  getDiagram(id: string): DiagramRecord {
    const row = this.database
      .prepare(
        `SELECT id, project_id, title, source, canvas_json, version, created_at, updated_at
         FROM diagrams
         WHERE id = ?`,
      )
      .get(id) as unknown as DiagramRow | undefined;
    if (!row) {
      throw new RecordNotFoundError('diagram', id);
    }
    return toDiagram(row);
  }

  updateDiagram(
    id: string,
    input: {
      title?: string;
      source?: string;
      canvas?: FlowchartCanvasV1 | null;
      version: number;
      force?: boolean;
    },
  ): DiagramRecord {
    const parsed = diagramUpdateSchema.parse(input);
    const current = this.getDiagram(id);
    const submitted: DiagramRecord = {
      ...current,
      title: parsed.title ?? current.title,
      source: parsed.source ?? current.source,
      canvas: parsed.canvas === undefined ? current.canvas : parsed.canvas,
      version: parsed.version,
    };
    if (!parsed.force && parsed.version !== current.version) {
      throw new VersionConflictError(current, submitted);
    }

    const updatedAt = new Date().toISOString();
    const nextVersion = current.version + 1;
    this.database
      .prepare(
        `UPDATE diagrams
         SET title = ?, source = ?, canvas_json = ?, version = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        submitted.title,
        submitted.source,
        submitted.canvas === null ? null : JSON.stringify(submitted.canvas),
        nextVersion,
        updatedAt,
        id,
      );
    this.touchProject(current.projectId, updatedAt);
    return this.getDiagram(id);
  }

  duplicateDiagram(id: string): DiagramRecord {
    const source = this.getDiagram(id);
    return this.insertDiagram({
      projectId: source.projectId,
      title: `${source.title} copy`,
      source: source.source,
      canvas: source.canvas,
    });
  }

  deleteDiagram(id: string): { deletedDiagramId: string } {
    const diagram = this.getDiagram(id);
    this.database.prepare('DELETE FROM diagrams WHERE id = ?').run(id);
    this.touchProject(diagram.projectId, new Date().toISOString());
    return { deletedDiagramId: id };
  }

  exportBackup(): LibraryBackupV2 {
    return {
      format: 'mermaid-workbench-backup',
      version: 2,
      exportedAt: new Date().toISOString(),
      ...this.listLibrary(),
    };
  }

  restoreBackup(input: unknown): void {
    const parsed = backupSchema.safeParse(input);
    if (!parsed.success) {
      throw new InvalidBackupError(
        'The selected file is not a valid Mermaid Workbench backup.',
        parsed.error.flatten(),
      );
    }

    const backup: LibraryBackup = parsed.data;
    assertUniqueIds(backup.projects, 'project');
    assertUniqueIds(backup.diagrams, 'diagram');
    const projectIds = new Set(backup.projects.map((project) => project.id));
    if (
      backup.diagrams.some(
        (diagram) => !projectIds.has(diagram.projectId),
      )
    ) {
      throw new InvalidBackupError(
        'The backup contains a diagram whose project is missing.',
      );
    }

    const diagrams =
      backup.version === 1
        ? backup.diagrams.map((diagram) => ({ ...diagram, canvas: null }))
        : backup.diagrams;

    this.database.exec('BEGIN IMMEDIATE;');
    try {
      this.database.exec('DELETE FROM diagrams; DELETE FROM projects;');
      const insertProject = this.database.prepare(
        `INSERT INTO projects (id, name, created_at, updated_at)
         VALUES (?, ?, ?, ?)`,
      );
      const insertDiagram = this.database.prepare(
        `INSERT INTO diagrams
          (id, project_id, title, source, canvas_json, version, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      );

      for (const project of backup.projects) {
        insertProject.run(
          project.id,
          project.name,
          project.createdAt,
          project.updatedAt,
        );
      }
      for (const diagram of diagrams) {
        insertDiagram.run(
          diagram.id,
          diagram.projectId,
          diagram.title,
          diagram.source,
          diagram.canvas === null ? null : JSON.stringify(diagram.canvas),
          diagram.version,
          diagram.createdAt,
          diagram.updatedAt,
        );
      }
      this.database.exec('COMMIT;');
    } catch (error) {
      this.database.exec('ROLLBACK;');
      throw new InvalidBackupError(
        'The backup could not be restored. The existing library was preserved.',
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  private getProject(id: string): ProjectRecord {
    const row = this.database
      .prepare(
        `SELECT id, name, created_at, updated_at
         FROM projects
         WHERE id = ?`,
      )
      .get(id) as unknown as ProjectRow | undefined;
    if (!row) {
      throw new RecordNotFoundError('project', id);
    }
    return toProject(row);
  }

  private insertDiagram(input: {
    projectId: string;
    title: string;
    source: string;
    canvas?: FlowchartCanvasV1 | null;
  }): DiagramRecord {
    const timestamp = new Date().toISOString();
    const diagram: DiagramRecord = {
      id: randomUUID(),
      projectId: input.projectId,
      title: input.title,
      source: input.source,
      canvas: input.canvas ?? null,
      version: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.database
      .prepare(
        `INSERT INTO diagrams
          (id, project_id, title, source, canvas_json, version, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        diagram.id,
        diagram.projectId,
        diagram.title,
        diagram.source,
        diagram.canvas === null ? null : JSON.stringify(diagram.canvas),
        diagram.version,
        diagram.createdAt,
        diagram.updatedAt,
      );
    this.touchProject(input.projectId, timestamp);
    return diagram;
  }

  private touchProject(projectId: string, updatedAt: string): void {
    this.database
      .prepare('UPDATE projects SET updated_at = ? WHERE id = ?')
      .run(updatedAt, projectId);
  }
}
