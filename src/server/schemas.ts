import { z } from 'zod';

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
    version: z.number().int().positive(),
    force: z.boolean().optional(),
  })
  .strict()
  .refine((value) => value.title !== undefined || value.source !== undefined, {
    message: 'At least one of title or source is required.',
  });

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
    version: z.number().int().positive(),
    createdAt: timestamp,
    updatedAt: timestamp,
  })
  .strict();

export const backupSchema = z
  .object({
    format: z.literal('mermaid-workbench-backup'),
    version: z.literal(1),
    exportedAt: timestamp,
    projects: z.array(projectRecordSchema),
    diagrams: z.array(diagramRecordSchema),
  })
  .strict();

export const restoreBackupRequestSchema = z
  .object({
    confirmReplace: z.literal(true),
    backup: backupSchema,
  })
  .strict();
