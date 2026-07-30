import type { FlowchartCanvasV1 } from './flowchart-canvas-schema';

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
  canvas: FlowchartCanvasV1 | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export type LegacyDiagramRecordV1 = Omit<DiagramRecord, 'canvas'>;

export interface LibraryIndex {
  projects: ProjectRecord[];
  diagrams: DiagramRecord[];
}

export interface LibraryBackupV1 {
  format: 'mermaid-workbench-backup';
  version: 1;
  exportedAt: string;
  projects: ProjectRecord[];
  diagrams: LegacyDiagramRecordV1[];
}

export interface LibraryBackupV2 extends LibraryIndex {
  format: 'mermaid-workbench-backup';
  version: 2;
  exportedAt: string;
}

export type LibraryBackup = LibraryBackupV1 | LibraryBackupV2;

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
