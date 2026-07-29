import type {
  ApiErrorBody,
  DiagramRecord,
  LibraryBackupV1,
  LibraryIndex,
  ProjectRecord,
} from '@shared/types';

export class ApiClientError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiClientError';
  }
}

async function requestJson<T>(
  route: string,
  init?: RequestInit,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(route, {
      ...init,
      headers: {
        ...(init?.body === undefined
          ? {}
          : { 'content-type': 'application/json' }),
        ...init?.headers,
      },
    });
  } catch {
    throw new ApiClientError(
      'The local Mermaid Workbench server is unavailable.',
      0,
      'NETWORK_ERROR',
    );
  }

  if (!response.ok) {
    let body: ApiErrorBody | undefined;
    try {
      body = (await response.json()) as ApiErrorBody;
    } catch {
      body = undefined;
    }
    throw new ApiClientError(
      body?.error.message ?? 'The request could not be completed.',
      response.status,
      body?.error.code ?? 'REQUEST_FAILED',
      body?.error.details,
    );
  }
  return (await response.json()) as T;
}

export const api = {
  listLibrary: () => requestJson<LibraryIndex>('/api/library'),

  createProject: (name: string) =>
    requestJson<ProjectRecord>('/api/projects', {
      method: 'POST',
      body: JSON.stringify({ name }),
    }),

  renameProject: (id: string, name: string) =>
    requestJson<ProjectRecord>(`/api/projects/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ name }),
    }),

  deleteProject: (id: string) =>
    requestJson<{
      deletedProjectId: string;
      deletedDiagramCount: number;
    }>(`/api/projects/${id}`, { method: 'DELETE' }),

  createDiagram: (
    projectId: string,
    title: string,
    source: string,
  ) =>
    requestJson<DiagramRecord>('/api/diagrams', {
      method: 'POST',
      body: JSON.stringify({ projectId, title, source }),
    }),

  getDiagram: (id: string) =>
    requestJson<DiagramRecord>(`/api/diagrams/${id}`),

  updateDiagram: (
    id: string,
    input: {
      title?: string;
      source?: string;
      version: number;
      force?: boolean;
    },
  ) =>
    requestJson<DiagramRecord>(`/api/diagrams/${id}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    }),

  duplicateDiagram: (id: string) =>
    requestJson<DiagramRecord>(`/api/diagrams/${id}/duplicate`, {
      method: 'POST',
    }),

  deleteDiagram: (id: string) =>
    requestJson<{ deletedDiagramId: string }>(`/api/diagrams/${id}`, {
      method: 'DELETE',
    }),

  exportDiagramUrl: (id: string) => `/api/diagrams/${id}/export`,
  exportBackupUrl: () => '/api/backup',

  restoreBackup: (backup: LibraryBackupV1) =>
    requestJson<{ restored: true }>('/api/backup/restore', {
      method: 'POST',
      body: JSON.stringify({ confirmReplace: true, backup }),
    }),
};

export type WorkbenchApi = typeof api;
