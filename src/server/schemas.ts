import { z } from 'zod';
import { flowchartCanvasV1Schema } from '@shared/flowchart-canvas-schema';

const nonBlankName = z.string().trim().min(1).max(120);
const diagramSource = z.string().max(2_000_000);
const recordId = z.string().uuid();
const timestamp = z.string().datetime();

export const projectInputSchema = z
  .object({
    name: nonBlankName,
  })
  .strict();

export const diagramInputSchema = z
  .object({
    projectId: recordId,
    title: nonBlankName,
    source: diagramSource,
  })
  .strict();

export const diagramUpdateSchema = z
  .object({
    title: nonBlankName.optional(),
    source: diagramSource.optional(),
    canvas: flowchartCanvasV1Schema.nullable().optional(),
    version: z.number().int().positive(),
    force: z.boolean().optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.title !== undefined ||
      value.source !== undefined ||
      value.canvas !== undefined,
    { message: 'At least one of title, source, or canvas is required.' },
  );

export const projectRecordSchema = z
  .object({
    id: recordId,
    name: nonBlankName,
    createdAt: timestamp,
    updatedAt: timestamp,
  })
  .strict();

export const diagramRecordSchema = z
  .object({
    id: recordId,
    projectId: recordId,
    title: nonBlankName,
    source: diagramSource,
    canvas: flowchartCanvasV1Schema.nullable(),
    version: z.number().int().positive(),
    createdAt: timestamp,
    updatedAt: timestamp,
  })
  .strict();

const legacyDiagramRecordSchema = diagramRecordSchema.omit({ canvas: true });

export const backupV1Schema = z
  .object({
    format: z.literal('mermaid-workbench-backup'),
    version: z.literal(1),
    exportedAt: timestamp,
    projects: z.array(projectRecordSchema),
    diagrams: z.array(legacyDiagramRecordSchema),
  })
  .strict();

export const backupV2Schema = z
  .object({
    format: z.literal('mermaid-workbench-backup'),
    version: z.literal(2),
    exportedAt: timestamp,
    projects: z.array(projectRecordSchema),
    diagrams: z.array(diagramRecordSchema),
  })
  .strict();

export const backupSchema = z.discriminatedUnion('version', [
  backupV1Schema,
  backupV2Schema,
]);

export const restoreBackupRequestSchema = z
  .object({
    confirmReplace: z.literal(true),
    backup: backupSchema,
  })
  .strict();
