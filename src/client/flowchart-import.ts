import type {
  FlowchartDirection,
  FlowchartEdgeV1,
  FlowchartLineStyle,
} from '../shared/flowchart-canvas-schema';
import { getMermaid } from './mermaid-runtime';

export interface ImportedFlowchartNode {
  id: string;
  label: string;
  shape: string;
}

export interface ImportedFlowchart {
  direction: FlowchartDirection;
  nodes: ImportedFlowchartNode[];
  edges: FlowchartEdgeV1[];
  warnings: Array<{ code: 'SHAPE_FALLBACK'; nodeId: string }>;
}

export type FlowchartImportResult =
  | { status: 'compatible'; graph: ImportedFlowchart }
  | {
    status: 'unsupported';
    reason: string;
    code?: 'INVALID_SYNTAX';
  };

interface FlowchartDatabase {
  getData: () => unknown;
  getSubGraphs: () => unknown;
  getDirection?: () => unknown;
}

interface FlowchartData {
  nodes: Record<string, unknown>[];
  edges: Record<string, unknown>[];
}

const MAX_FLOWCHART_ID_LENGTH = 240;
const reviewedFlowchartTypes = new Set(['flowchart-v2']);

const lineStyle = {
  normal: 'solid',
  dotted: 'dotted',
  thick: 'thick',
  invisible: 'invisible',
} as const satisfies Record<string, FlowchartLineStyle>;

const supportedShapes = new Set([
  'squareRect',
  'roundedRect',
  'circle',
  'doublecircle',
  'diamond',
  'stadium',
  'subroutine',
  'cylinder',
  'hexagon',
  'trapezoid',
  'inv_trapezoid',
  'lean_right',
  'lean_left',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function requireFlowchartDatabase(value: unknown): FlowchartDatabase {
  if (
    !isRecord(value) ||
    typeof value.getData !== 'function' ||
    typeof value.getSubGraphs !== 'function'
  ) {
    throw new Error('Mermaid flowchart data is unavailable.');
  }

  return value as unknown as FlowchartDatabase;
}

function requireFlowchartData(value: unknown): FlowchartData {
  if (
    !isRecord(value) ||
    !Array.isArray(value.nodes) ||
    !value.nodes.every(isRecord) ||
    !Array.isArray(value.edges) ||
    !value.edges.every(isRecord)
  ) {
    throw new Error('Mermaid returned an incompatible flowchart model.');
  }

  return {
    nodes: value.nodes,
    edges: value.edges,
  };
}

function normalizeDirection(value: unknown): FlowchartDirection {
  if (value === undefined || value === 'TB' || value === 'TD') {
    return 'TB';
  }
  if (value === 'BT' || value === 'LR' || value === 'RL') {
    return value;
  }
  throw new Error('Mermaid returned an unsupported flowchart direction.');
}

function requireString(
  value: unknown,
  description: string,
  allowEmpty = false,
): string {
  if (
    typeof value !== 'string' ||
    (!allowEmpty && value.trim().length === 0)
  ) {
    throw new Error(`Mermaid returned an invalid ${description}.`);
  }
  return value;
}

function requireFlowchartId(value: unknown, description: string): string {
  const id = requireString(value, description);
  if (id.length > MAX_FLOWCHART_ID_LENGTH) {
    throw new Error(
      `Mermaid ${description} exceeds the supported ID length.`,
    );
  }
  return id;
}

function containsHtml(value: string): boolean {
  return /<\/?[A-Za-z][^>]*>/.test(value);
}

function isInteractiveNode(node: Record<string, unknown>): boolean {
  return (
    node.haveCallback === true ||
    typeof node.link === 'string' ||
    (typeof node.cssClasses === 'string' &&
      node.cssClasses.split(/\s+/).includes('clickable'))
  );
}

function normalizeNodes(
  nodes: Record<string, unknown>[],
): Pick<ImportedFlowchart, 'nodes' | 'warnings'> {
  const warnings: ImportedFlowchart['warnings'] = [];
  const normalized = nodes.map((node) => {
    const id = requireFlowchartId(node.id, 'flowchart node ID');
    const label = requireString(node.label, `label for node "${id}"`, true);
    if (containsHtml(label)) {
      throw new Error('HTML labels are not supported in interactive mode.');
    }
    if (isInteractiveNode(node)) {
      throw new Error('Interactive Mermaid nodes are not supported.');
    }

    const shape = requireString(node.shape, `shape for node "${id}"`);
    if (!supportedShapes.has(shape)) {
      warnings.push({ code: 'SHAPE_FALLBACK', nodeId: id });
    }

    return { id, label, shape };
  });

  return { nodes: normalized, warnings };
}

function normalizeLineStyle(value: unknown): FlowchartLineStyle {
  if (typeof value === 'string' && Object.hasOwn(lineStyle, value)) {
    return lineStyle[value as keyof typeof lineStyle];
  }
  throw new Error('Mermaid returned an unsupported edge line style.');
}

function hasArrow(value: unknown): boolean {
  if (value === undefined || value === 'none') {
    return false;
  }
  if (typeof value === 'string') {
    return true;
  }
  throw new Error('Mermaid returned invalid edge arrow metadata.');
}

function normalizeEdges(edges: Record<string, unknown>[]): FlowchartEdgeV1[] {
  const endpointOccurrences = new Map<string, number>();

  return edges.map((edge) => {
    const source = requireFlowchartId(edge.start, 'edge source');
    const target = requireFlowchartId(edge.end, 'edge target');
    const endpointKey = `${source}\u0000${target}`;
    const occurrence = endpointOccurrences.get(endpointKey) ?? 0;
    endpointOccurrences.set(endpointKey, occurrence + 1);
    const parsedLabel = requireString(edge.label, 'edge label', true);
    if (containsHtml(parsedLabel)) {
      throw new Error(
        'HTML edge labels are not supported in interactive mode.',
      );
    }
    const label = parsedLabel.length > 0 ? parsedLabel : undefined;
    const id = `edge|${encodeURIComponent(source)}|${encodeURIComponent(target)}|${occurrence}`;
    if (id.length > MAX_FLOWCHART_ID_LENGTH) {
      throw new Error('Mermaid edge ID exceeds the supported ID length.');
    }

    return {
      id,
      source,
      target,
      ...(label === undefined ? {} : { label }),
      arrowStart: hasArrow(edge.arrowTypeStart),
      arrowEnd: hasArrow(edge.arrowTypeEnd),
      lineStyle: normalizeLineStyle(edge.thickness),
    };
  });
}

function conciseReason(error: unknown): string {
  const fallback = 'Mermaid flowchart import is unsupported.';
  if (!(error instanceof Error)) {
    return fallback;
  }
  const firstLine = error.message.split('\n', 1)[0]?.trim();
  if (!firstLine) {
    return fallback;
  }
  return firstLine.slice(0, 180);
}

export function normalizeMermaidFlowchartDiagram(
  diagram: unknown,
): FlowchartImportResult {
  try {
    if (
      !isRecord(diagram) ||
      typeof diagram.type !== 'string' ||
      !reviewedFlowchartTypes.has(diagram.type)
    ) {
      return {
        status: 'unsupported',
        reason: 'Only Mermaid flowcharts support interactive mode.',
      };
    }

    const database = requireFlowchartDatabase(diagram.db);
    const subgraphs = database.getSubGraphs();
    if (!Array.isArray(subgraphs)) {
      throw new Error('Mermaid returned invalid subgraph metadata.');
    }
    if (subgraphs.length > 0) {
      return {
        status: 'unsupported',
        reason: 'Flowchart subgraphs are not supported in interactive mode.',
      };
    }

    const data = requireFlowchartData(database.getData());
    const { nodes, warnings } = normalizeNodes(data.nodes);
    return {
      status: 'compatible',
      graph: {
        direction: normalizeDirection(database.getDirection?.()),
        nodes,
        edges: normalizeEdges(data.edges),
        warnings,
      },
    };
  } catch (error) {
    return { status: 'unsupported', reason: conciseReason(error) };
  }
}

export async function importMermaidFlowchart(
  source: string,
): Promise<FlowchartImportResult> {
  try {
    const mermaid = await getMermaid();
    const diagram = await mermaid.mermaidAPI.getDiagramFromText(source);
    return normalizeMermaidFlowchartDiagram(diagram);
  } catch (error) {
    return {
      status: 'unsupported',
      reason: conciseReason(error),
      code: 'INVALID_SYNTAX',
    };
  }
}
