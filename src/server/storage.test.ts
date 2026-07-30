import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { LibraryBackupV1 } from '@shared/types';
import type { FlowchartCanvasV1 } from '@shared/flowchart-canvas-schema';
import {
  InvalidBackupError,
  VersionConflictError,
  WorkbenchStore,
} from './storage';

const validCanvas = {
  kind: 'flowchart',
  version: 1,
  direction: 'LR',
  nodes: [
    {
      id: 'idea',
      label: 'Idea',
      shape: 'rect',
      position: { x: 120, y: 80 },
    },
    {
      id: 'ship',
      label: 'Ship',
      shape: 'rect',
      position: { x: 360, y: 80 },
    },
  ],
  edges: [
    {
      id: 'idea-to-ship',
      source: 'idea',
      target: 'ship',
      arrowStart: false,
      arrowEnd: true,
      lineStyle: 'solid',
    },
  ],
} satisfies FlowchartCanvasV1;

function createLegacyDatabase(databasePath: string): void {
  const legacy = new DatabaseSync(databasePath);
  legacy.exec(`
    CREATE TABLE projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;
    CREATE TABLE diagrams (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      source TEXT NOT NULL,
      version INTEGER NOT NULL CHECK (version > 0),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;
  `);
  legacy.close();
}

describe('WorkbenchStore', () => {
  let directory: string;
  let store: WorkbenchStore;

  beforeEach(() => {
    directory = mkdtempSync(path.join(tmpdir(), 'mermaid-workbench-'));
    store = new WorkbenchStore(path.join(directory, 'test.sqlite3'));
  });

  afterEach(() => {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it('creates, renames, lists, and deletes projects', () => {
    const created = store.createProject({ name: ' Launch maps ' });
    expect(created).toMatchObject({
      id: expect.any(String),
      name: 'Launch maps',
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    });

    const renamed = store.renameProject(created.id, { name: 'Release maps' });
    expect(renamed).toMatchObject({
      id: created.id,
      name: 'Release maps',
      createdAt: created.createdAt,
    });
    expect(store.listLibrary().projects).toEqual([renamed]);

    expect(store.deleteProject(created.id)).toEqual({
      deletedProjectId: created.id,
      deletedDiagramCount: 0,
    });
    expect(store.listLibrary()).toEqual({ projects: [], diagrams: [] });
  });

  it('creates, updates, duplicates, and deletes diagrams', () => {
    const project = store.createProject({ name: 'Launch maps' });
    const created = store.createDiagram({
      projectId: project.id,
      title: ' Release path ',
      source: 'flowchart LR\n  Idea --> Ship',
    });

    expect(created).toMatchObject({
      id: expect.any(String),
      projectId: project.id,
      title: 'Release path',
      source: 'flowchart LR\n  Idea --> Ship',
      version: 1,
    });
    expect(store.getDiagram(created.id)).toEqual(created);

    const updated = store.updateDiagram(created.id, {
      title: 'Production path',
      source: 'flowchart LR\n  Build --> Ship',
      version: 1,
    });
    expect(updated).toMatchObject({
      id: created.id,
      title: 'Production path',
      source: 'flowchart LR\n  Build --> Ship',
      version: 2,
    });

    const duplicate = store.duplicateDiagram(updated.id);
    expect(duplicate).toMatchObject({
      id: expect.not.stringMatching(updated.id),
      projectId: project.id,
      title: 'Production path copy',
      source: updated.source,
      version: 1,
    });

    expect(store.deleteDiagram(updated.id)).toEqual({
      deletedDiagramId: updated.id,
    });
    expect(store.listLibrary().diagrams).toEqual([duplicate]);
  });

  it('migrates a legacy database once and exposes legacy diagrams without a canvas', () => {
    store.close();
    const databasePath = path.join(directory, 'legacy.sqlite3');
    createLegacyDatabase(databasePath);
    const timestamp = new Date().toISOString();
    const legacy = new DatabaseSync(databasePath);
    const projectId = crypto.randomUUID();
    const diagramId = crypto.randomUUID();
    legacy
      .prepare(
        'INSERT INTO projects (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)',
      )
      .run(projectId, 'Legacy', timestamp, timestamp);
    legacy
      .prepare(
        'INSERT INTO diagrams (id, project_id, title, source, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(diagramId, projectId, 'Legacy diagram', 'flowchart LR', 1, timestamp, timestamp);
    legacy.close();

    store = new WorkbenchStore(databasePath);
    expect(store.getDiagram(diagramId)).toMatchObject({ canvas: null });
    store.close();
    store = new WorkbenchStore(databasePath);
    expect(store.getDiagram(diagramId)).toMatchObject({ canvas: null });
  });

  it('persists canvas updates, preserves canvas on omitted updates, clears null canvas, and rejects invalid or stale writes', () => {
    const project = store.createProject({ name: 'Canvas maps' });
    const created = store.createDiagram({
      projectId: project.id,
      title: 'Canvas diagram',
      source: 'flowchart LR\n  Idea --> Ship',
    });
    expect(created.canvas).toBeNull();

    const updated = store.updateDiagram(created.id, {
      canvas: validCanvas,
      version: created.version,
    });
    expect(updated).toMatchObject({ canvas: validCanvas, version: 2 });
    expect(updated.source).toBe(created.source);

    const omittedCanvas = store.updateDiagram(created.id, {
      title: 'Canvas diagram revised',
      version: updated.version,
    });
    expect(omittedCanvas).toMatchObject({
      canvas: validCanvas,
      source: created.source,
      version: 3,
    });
    expect(store.duplicateDiagram(omittedCanvas.id)).toMatchObject({
      canvas: validCanvas,
      version: 1,
    });

    const clearedCanvas = store.updateDiagram(created.id, {
      canvas: null,
      version: omittedCanvas.version,
    });
    expect(clearedCanvas).toMatchObject({
      canvas: null,
      source: created.source,
      version: 4,
    });

    const beforeInvalid = store.getDiagram(created.id);
    expect(() =>
      store.updateDiagram(created.id, {
        canvas: {
          ...validCanvas,
          edges: [{ ...validCanvas.edges[0], target: 'missing' }],
        },
        version: clearedCanvas.version,
      }),
    ).toThrow();
    expect(store.getDiagram(created.id)).toEqual(beforeInvalid);

    expect(() =>
      store.updateDiagram(created.id, {
        canvas: validCanvas,
        version: created.version,
      }),
    ).toThrow(VersionConflictError);
  });

  it('deletes only the selected project and reports its cascade size', () => {
    const first = store.createProject({ name: 'First' });
    const second = store.createProject({ name: 'Second' });
    store.createDiagram({
      projectId: first.id,
      title: 'A',
      source: 'flowchart LR\n  A --> B',
    });
    store.createDiagram({
      projectId: first.id,
      title: 'B',
      source: 'flowchart LR\n  B --> C',
    });
    const preserved = store.createDiagram({
      projectId: second.id,
      title: 'C',
      source: 'flowchart LR\n  C --> D',
    });
    const preservedProject = store
      .listLibrary()
      .projects.find((project) => project.id === second.id)!;

    expect(store.deleteProject(first.id)).toEqual({
      deletedProjectId: first.id,
      deletedDiagramCount: 2,
    });
    expect(store.listLibrary()).toEqual({
      projects: [preservedProject],
      diagrams: [preserved],
    });
  });

  it('rejects a stale update and returns both versions', () => {
    const project = store.createProject({ name: 'Launch maps' });
    const created = store.createDiagram({
      projectId: project.id,
      title: 'Release path',
      source: 'flowchart LR\n  Idea --> Ship',
    });
    const current = store.updateDiagram(created.id, {
      source: 'flowchart LR\n  Idea --> Build --> Ship',
      version: created.version,
    });

    try {
      store.updateDiagram(created.id, {
        source: 'flowchart TD\n  Stale --> Edit',
        version: created.version,
      });
      throw new Error('Expected an optimistic version conflict.');
    } catch (error) {
      expect(error).toBeInstanceOf(VersionConflictError);
      expect(error).toMatchObject({
        current,
        submitted: {
          id: created.id,
          projectId: created.projectId,
          title: created.title,
          source: 'flowchart TD\n  Stale --> Edit',
          version: created.version,
        },
      });
    }
    expect(store.getDiagram(created.id)).toEqual(current);
  });

  it('allows an explicit force update after a conflict', () => {
    const project = store.createProject({ name: 'Launch maps' });
    const created = store.createDiagram({
      projectId: project.id,
      title: 'Release path',
      source: 'flowchart LR\n  A --> B',
    });
    const current = store.updateDiagram(created.id, {
      source: 'flowchart LR\n  A --> B --> C',
      version: created.version,
    });

    const forced = store.updateDiagram(created.id, {
      source: 'flowchart TD\n  Mine --> Wins',
      version: created.version,
      force: true,
    });
    expect(forced).toMatchObject({
      source: 'flowchart TD\n  Mine --> Wins',
      version: current.version + 1,
    });
  });

  it('exports a portable versioned backup and restores it', () => {
    const project = store.createProject({ name: 'Launch maps' });
    const diagram = store.createDiagram({
      projectId: project.id,
      title: 'Release path',
      source: 'flowchart LR\n  Idea --> Ship',
    });
    const storedProject = store.listLibrary().projects[0];

    const backup = store.exportBackup();
    expect(backup).toEqual({
      format: 'mermaid-workbench-backup',
      version: 2,
      exportedAt: expect.any(String),
      projects: [storedProject],
      diagrams: [diagram],
    });

    store.createProject({ name: 'Disposable' });
    store.restoreBackup(backup);
    expect(store.listLibrary()).toEqual({
      projects: backup.projects,
      diagrams: backup.diagrams,
    });
  });

  it('exports V2 backups, restores literal V1 backups, and preserves data after an invalid V2 backup', () => {
    const project = store.createProject({ name: 'Canvas backups' });
    const diagram = store.createDiagram({
      projectId: project.id,
      title: 'Canvas diagram',
      source: 'flowchart LR\n  Idea --> Ship',
    });
    const withCanvas = store.updateDiagram(diagram.id, {
      canvas: validCanvas,
      version: diagram.version,
    });

    expect(store.exportBackup()).toMatchObject({
      format: 'mermaid-workbench-backup',
      version: 2,
    });

    const v1Backup = {
      format: 'mermaid-workbench-backup',
      version: 1,
      exportedAt: new Date().toISOString(),
      projects: [project],
      diagrams: [
        {
          id: withCanvas.id,
          projectId: withCanvas.projectId,
          title: withCanvas.title,
          source: withCanvas.source,
          version: withCanvas.version,
          createdAt: withCanvas.createdAt,
          updatedAt: withCanvas.updatedAt,
        },
      ],
    };
    store.restoreBackup(v1Backup);
    expect(store.getDiagram(withCanvas.id)).toMatchObject({ canvas: null });

    const v2Backup = {
      ...store.exportBackup(),
      diagrams: [{ ...withCanvas, canvas: validCanvas }],
    };
    store.restoreBackup(v2Backup);
    expect(store.getDiagram(withCanvas.id)).toMatchObject({ canvas: validCanvas });

    const beforeInvalid = store.listLibrary();
    expect(() =>
      store.restoreBackup({
        ...v2Backup,
        diagrams: [
          {
            ...withCanvas,
            canvas: {
              ...validCanvas,
              edges: [{ ...validCanvas.edges[0], source: 'missing' }],
            },
          },
        ],
      }),
    ).toThrow(InvalidBackupError);
    expect(store.listLibrary()).toEqual(beforeInvalid);
  });

  it('rejects an invalid backup before changing stored data', () => {
    const project = store.createProject({ name: 'Preserved' });
    const diagram = store.createDiagram({
      projectId: project.id,
      title: 'Still here',
      source: 'flowchart LR\n  Safe --> Data',
    });
    const before = store.listLibrary();
    const invalidBackup: LibraryBackupV1 = {
      format: 'mermaid-workbench-backup',
      version: 1,
      exportedAt: new Date().toISOString(),
      projects: [],
      diagrams: [
        {
          id: diagram.id,
          projectId: crypto.randomUUID(),
          title: diagram.title,
          source: diagram.source,
          version: diagram.version,
          createdAt: diagram.createdAt,
          updatedAt: diagram.updatedAt,
        },
      ],
    };

    expect(() => store.restoreBackup(invalidBackup)).toThrow(
      InvalidBackupError,
    );
    expect(store.listLibrary()).toEqual(before);
  });

  it('rejects backup records with unknown fields', () => {
    const before = store.listLibrary();
    const invalidBackup = {
      format: 'mermaid-workbench-backup',
      version: 1,
      exportedAt: new Date().toISOString(),
      projects: [],
      diagrams: [],
      unexpected: true,
    };

    expect(() => store.restoreBackup(invalidBackup)).toThrow(
      InvalidBackupError,
    );
    expect(store.listLibrary()).toEqual(before);
  });
});
