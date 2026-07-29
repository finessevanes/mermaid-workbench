import { mkdtempSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type {
  ApiErrorBody,
  DiagramRecord,
  LibraryBackupV1,
  LibraryIndex,
  ProjectRecord,
} from '@shared/types';
import { createWorkbenchServer } from './http';
import { WorkbenchStore } from './storage';

interface ResponseSnapshot<T = unknown> {
  status: number;
  body: T;
  headers: Headers;
}

describe('local HTTP API', () => {
  let directory: string;
  let store: WorkbenchStore;
  let server: Server;
  let baseUrl: string;

  beforeEach(async () => {
    directory = mkdtempSync(path.join(tmpdir(), 'mermaid-workbench-http-'));
    store = new WorkbenchStore(path.join(directory, 'test.sqlite3'));
    server = createWorkbenchServer({
      store,
      allowedOrigins: new Set(['http://127.0.0.1:5173']),
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address() as AddressInfo;
    expect(address.address).toBe('127.0.0.1');
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });

  async function request<T = unknown>(
    method: string,
    route: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ): Promise<ResponseSnapshot<T>> {
    const response = await fetch(`${baseUrl}${route}`, {
      method,
      headers: {
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const contentType = response.headers.get('content-type') ?? '';
    const parsedBody = contentType.includes('application/json')
      ? await response.json()
      : await response.text();
    return {
      status: response.status,
      body: parsedBody as T,
      headers: response.headers,
    };
  }

  it('serves health and rejects an unexpected browser origin', async () => {
    expect(await request('GET', '/api/health')).toMatchObject({
      status: 200,
      body: { status: 'ok' },
    });
    expect(
      await request<ApiErrorBody>('GET', '/api/library', undefined, {
        Origin: 'https://attacker.example',
      }),
    ).toMatchObject({
      status: 403,
      body: {
        error: {
          code: 'ORIGIN_FORBIDDEN',
          message: 'This local API does not accept requests from that origin.',
        },
      },
    });
    expect(
      await request('GET', '/api/library', undefined, {
        Origin: 'http://127.0.0.1:5173',
      }),
    ).toMatchObject({
      status: 200,
      body: { projects: [], diagrams: [] },
    });
  });

  it('validates requests strictly and rejects path-like identifiers', async () => {
    expect(
      await request<ApiErrorBody>('POST', '/api/projects', {
        name: 'Launch maps',
        extra: true,
      }),
    ).toMatchObject({
      status: 400,
      body: { error: { code: 'INVALID_REQUEST' } },
    });
    expect(
      await request<ApiErrorBody>(
        'GET',
        '/api/diagrams/..%2Fprivate%2Fsecrets',
      ),
    ).toMatchObject({
      status: 400,
      body: {
        error: {
          code: 'INVALID_IDENTIFIER',
          message: 'The record identifier is invalid.',
        },
      },
    });
    expect(
      await request<ApiErrorBody>('GET', '/api/not-a-route'),
    ).toMatchObject({
      status: 404,
      body: { error: { code: 'NOT_FOUND' } },
    });
  });

  it('creates and mutates projects and diagrams through JSON routes', async () => {
    const projectResponse = await request<ProjectRecord>(
      'POST',
      '/api/projects',
      { name: 'Launch maps' },
    );
    expect(projectResponse).toMatchObject({
      status: 201,
      body: { name: 'Launch maps' },
    });
    const project = projectResponse.body;

    const diagramResponse = await request<DiagramRecord>(
      'POST',
      '/api/diagrams',
      {
        projectId: project.id,
        title: 'Release path',
        source: 'flowchart LR\n  Idea --> Ship',
      },
    );
    expect(diagramResponse.status).toBe(201);
    const diagram = diagramResponse.body;

    expect(
      await request<DiagramRecord>('GET', `/api/diagrams/${diagram.id}`),
    ).toMatchObject({ status: 200, body: diagram });

    const updatedResponse = await request<DiagramRecord>(
      'PUT',
      `/api/diagrams/${diagram.id}`,
      {
        source: 'flowchart LR\n  Idea --> Build --> Ship',
        version: diagram.version,
      },
    );
    expect(updatedResponse).toMatchObject({
      status: 200,
      body: {
        source: 'flowchart LR\n  Idea --> Build --> Ship',
        version: 2,
      },
    });

    const duplicateResponse = await request<DiagramRecord>(
      'POST',
      `/api/diagrams/${diagram.id}/duplicate`,
    );
    expect(duplicateResponse).toMatchObject({
      status: 201,
      body: { title: 'Release path copy', version: 1 },
    });

    const library = await request<LibraryIndex>('GET', '/api/library');
    expect(library.body.projects).toHaveLength(1);
    expect(library.body.diagrams).toHaveLength(2);

    expect(
      await request('DELETE', `/api/diagrams/${diagram.id}`),
    ).toMatchObject({
      status: 200,
      body: { deletedDiagramId: diagram.id },
    });
    expect(
      await request('DELETE', `/api/projects/${project.id}`),
    ).toMatchObject({
      status: 200,
      body: {
        deletedProjectId: project.id,
        deletedDiagramCount: 1,
      },
    });
  });

  it('returns both diagram versions for an optimistic conflict', async () => {
    const project = store.createProject({ name: 'Launch maps' });
    const diagram = store.createDiagram({
      projectId: project.id,
      title: 'Release path',
      source: 'flowchart LR\n  A --> B',
    });
    const current = store.updateDiagram(diagram.id, {
      source: 'flowchart LR\n  A --> B --> C',
      version: diagram.version,
    });

    const response = await request<ApiErrorBody>(
      'PUT',
      `/api/diagrams/${diagram.id}`,
      {
        source: 'flowchart TD\n  Mine --> Version',
        version: diagram.version,
      },
    );
    expect(response).toMatchObject({
      status: 409,
      body: {
        error: {
          code: 'VERSION_CONFLICT',
          details: {
            current,
            submitted: {
              id: diagram.id,
              source: 'flowchart TD\n  Mine --> Version',
              version: diagram.version,
            },
          },
        },
      },
    });
  });

  it('exports safe filenames and restores backups only with confirmation', async () => {
    const project = store.createProject({ name: 'Launch maps' });
    const diagram = store.createDiagram({
      projectId: project.id,
      title: '../Release: path',
      source: 'flowchart LR\n  A --> B',
    });

    const exported = await request<string>(
      'GET',
      `/api/diagrams/${diagram.id}/export`,
    );
    expect(exported).toMatchObject({
      status: 200,
      body: diagram.source,
    });
    expect(exported.headers.get('content-disposition')).toBe(
      'attachment; filename="Release-path.mmd"',
    );

    const backupResponse = await request<LibraryBackupV1>(
      'GET',
      '/api/backup',
    );
    expect(backupResponse).toMatchObject({
      status: 200,
      body: {
        format: 'mermaid-workbench-backup',
        version: 1,
      },
    });

    store.createProject({ name: 'Disposable' });
    expect(
      await request<ApiErrorBody>('POST', '/api/backup/restore', {
        confirmReplace: false,
        backup: backupResponse.body,
      }),
    ).toMatchObject({
      status: 409,
      body: { error: { code: 'RESTORE_CONFIRMATION_REQUIRED' } },
    });
    expect(store.listLibrary().projects).toHaveLength(2);

    expect(
      await request('POST', '/api/backup/restore', {
        confirmReplace: true,
        backup: backupResponse.body,
      }),
    ).toMatchObject({
      status: 200,
      body: { restored: true },
    });
    expect(store.listLibrary()).toEqual({
      projects: backupResponse.body.projects,
      diagrams: backupResponse.body.diagrams,
    });
  });
});
