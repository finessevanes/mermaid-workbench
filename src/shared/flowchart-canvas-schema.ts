import { z } from 'zod';

export const FLOWCHART_CANVAS_VERSION = 1 as const;

export type FlowchartDirection = 'TB' | 'BT' | 'LR' | 'RL';
export type FlowchartLineStyle = 'solid' | 'dotted' | 'thick' | 'invisible';

export interface FlowchartNodeV1 {
  id: string;
  label: string;
  shape: string;
  position: { x: number; y: number };
}

export interface FlowchartEdgeV1 {
  id: string;
  source: string;
  target: string;
  label?: string;
  arrowStart: boolean;
  arrowEnd: boolean;
  lineStyle: FlowchartLineStyle;
}

export interface FlowchartCanvasV1 {
  kind: 'flowchart';
  version: 1;
  direction: FlowchartDirection;
  nodes: FlowchartNodeV1[];
  edges: FlowchartEdgeV1[];
}

const canvasId = z.string().trim().min(1).max(240);
const finiteNumber = z.number().finite();

export const flowchartCanvasV1Schema: z.ZodType<FlowchartCanvasV1> = z
  .object({
    kind: z.literal('flowchart'),
    version: z.literal(FLOWCHART_CANVAS_VERSION),
    direction: z.enum(['TB', 'BT', 'LR', 'RL']),
    nodes: z
      .array(
        z
          .object({
            id: canvasId,
            label: z.string().max(20_000),
            shape: z.string(),
            position: z.object({ x: finiteNumber, y: finiteNumber }).strict(),
          })
          .strict(),
      )
      .max(5_000),
    edges: z
      .array(
        z
          .object({
            id: canvasId,
            source: canvasId,
            target: canvasId,
            label: z.string().max(20_000).optional(),
            arrowStart: z.boolean(),
            arrowEnd: z.boolean(),
            lineStyle: z.enum(['solid', 'dotted', 'thick', 'invisible']),
          })
          .strict(),
      )
      .max(10_000),
  })
  .strict()
  .superRefine((canvas, context) => {
    const nodeIds = new Set<string>();
    canvas.nodes.forEach((node, index) => {
      if (nodeIds.has(node.id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate node ID: ${node.id}`,
          path: ['nodes', index, 'id'],
        });
      }
      nodeIds.add(node.id);
    });

    const edgeIds = new Set<string>();
    canvas.edges.forEach((edge, index) => {
      if (edgeIds.has(edge.id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate edge ID: ${edge.id}`,
          path: ['edges', index, 'id'],
        });
      }
      edgeIds.add(edge.id);

      if (!nodeIds.has(edge.source)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Dangling edge source: ${edge.source}`,
          path: ['edges', index, 'source'],
        });
      }

      if (!nodeIds.has(edge.target)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Dangling edge target: ${edge.target}`,
          path: ['edges', index, 'target'],
        });
      }
    });
  });

export function validateFlowchartCanvas(input: unknown): FlowchartCanvasV1 {
  return flowchartCanvasV1Schema.parse(input);
}
