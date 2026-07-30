import * as dagre from '@dagrejs/dagre';
import type {
  FlowchartCanvasV1,
  FlowchartNodeV1,
} from '../shared/flowchart-canvas-schema';
import type { ImportedFlowchart } from './flowchart-import';

export interface ReconciliationSummary {
  added: number;
  removed: number;
  preserved: number;
}

export function flowchartNodeSize(shape: string, label: string) {
  const width = Math.min(260, Math.max(120, 56 + label.length * 7));
  const height = shape === 'circle' || shape === 'doublecircle'
    ? Math.max(88, Math.min(160, width))
    : 72;
  return { width, height };
}

interface PositionedDagreNode {
  x: number;
  y: number;
}

function positionedNode(
  dagreGraph: dagre.graphlib.Graph,
  id: string,
): PositionedDagreNode {
  const node = dagreGraph.node(id) as PositionedDagreNode | undefined;
  if (!node || !Number.isFinite(node.x) || !Number.isFinite(node.y)) {
    throw new Error(`Dagre returned invalid coordinates for node "${id}".`);
  }
  return node;
}

export function layoutImportedFlowchart(
  graph: ImportedFlowchart,
): FlowchartCanvasV1 {
  const dagreGraph = new dagre.graphlib.Graph({ multigraph: true })
    .setGraph({
      rankdir: graph.direction,
      ranksep: 90,
      nodesep: 64,
      edgesep: 32,
      marginx: 40,
      marginy: 40,
    })
    .setDefaultEdgeLabel(() => ({}));

  for (const node of graph.nodes) {
    dagreGraph.setNode(node.id, flowchartNodeSize(node.shape, node.label));
  }

  for (const edge of graph.edges) {
    dagreGraph.setEdge(edge.source, edge.target, {}, edge.id);
  }

  dagre.layout(dagreGraph);

  const nodes = graph.nodes.map<FlowchartNodeV1>((node) => {
    const { x, y } = positionedNode(dagreGraph, node.id);
    const { width, height } = flowchartNodeSize(node.shape, node.label);
    return {
      ...node,
      position: {
        x: x - width / 2,
        y: y - height / 2,
      },
    };
  });

  return {
    kind: 'flowchart',
    version: 1,
    direction: graph.direction,
    nodes,
    edges: graph.edges.map((edge) => ({ ...edge })),
  };
}

export function reconcileFlowchartImport(
  previous: FlowchartCanvasV1,
  graph: ImportedFlowchart,
): {
  canvas: FlowchartCanvasV1;
  summary: ReconciliationSummary;
} {
  const laidOutCanvas = layoutImportedFlowchart(graph);
  const previousNodeById = new Map(previous.nodes.map((node) => [node.id, node]));
  const importedIds = new Set(graph.nodes.map((node) => node.id));
  const previousIds = new Set(previous.nodes.map((node) => node.id));

  const nodes = laidOutCanvas.nodes.map((node) => {
    const previousNode = previousNodeById.get(node.id);
    if (!previousNode) {
      return node;
    }
    return {
      ...node,
      position: { ...previousNode.position },
    };
  });

  const summary = {
    added: [...importedIds].filter((id) => !previousIds.has(id)).length,
    removed: [...previousIds].filter((id) => !importedIds.has(id)).length,
    preserved: [...importedIds].filter((id) => previousIds.has(id)).length,
  };

  return {
    canvas: { ...laidOutCanvas, nodes },
    summary,
  };
}
