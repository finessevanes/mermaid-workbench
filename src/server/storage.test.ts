import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { LibraryBackupV1 } from '@shared/types';
import {
  InvalidBackupError,
  VersionConflictError,
  WorkbenchStore,
} from './storage';

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
      version: 1,
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
      diagrams: [{ ...diagram, projectId: crypto.randomUUID() }],
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
