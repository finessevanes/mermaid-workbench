export interface ProjectRecord {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface DiagramRecord {
  id: string;
  projectId: string;
  title: string;
  source: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface LibraryIndex {
  projects: ProjectRecord[];
  diagrams: DiagramRecord[];
}

export interface LibraryBackupV1 extends LibraryIndex {
  format: 'mermaid-workbench-backup';
  version: 1;
  exportedAt: string;
}

export interface ConflictDetails {
  current: DiagramRecord;
  submitted: DiagramRecord;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}
