import {
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type NodeChange,
  type NodeTypes,
  type EdgeTypes,
} from '@xyflow/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type React from 'react';
import type { FlowchartCanvasV1 } from '../../shared/flowchart-canvas-schema';
import { FlowchartNode } from './FlowchartNode';
import { FloatingFlowchartEdge } from './FloatingFlowchartEdge';
import {
  applyReactFlowNodeChanges,
  toReactFlowEdges,
  toReactFlowNodes,
} from './flowchart-react-flow';

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 4;
const ZOOM_STEP = 0.1;

const nodeTypes: NodeTypes = { flowchart: FlowchartNode };
const edgeTypes: EdgeTypes = { floatingFlowchart: FloatingFlowchartEdge };

export interface FlowchartCanvasProps {
  canvas: FlowchartCanvasV1;
  sourceLayoutRevision?: number;
  onCanvasChange: (canvas: FlowchartCanvasV1) => void;
  onCommit: (canvas: FlowchartCanvasV1) => void;
  onResetLayout: () => void;
}

function clampZoom(zoom: number): number {
  return Math.round(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom)) * 100) / 100;
}

function FlowchartCanvasContents({
  canvas,
  sourceLayoutRevision,
  onCanvasChange,
  onCommit,
  onResetLayout,
}: FlowchartCanvasProps): React.JSX.Element {
  const { fitView, setViewport, zoomTo } = useReactFlow();
  const [zoom, setZoom] = useState(1);
  const latestCanvasRef = useRef(canvas);
  const automaticFitRef = useRef(true);
  const fittedSourceLayoutRevisionRef = useRef<number | undefined>(Number.NaN);

  useEffect(() => {
    latestCanvasRef.current = canvas;
  }, [canvas]);

  useEffect(() => {
    if (
      !automaticFitRef.current ||
      fittedSourceLayoutRevisionRef.current === sourceLayoutRevision
    ) {
      return;
    }
    fittedSourceLayoutRevisionRef.current = sourceLayoutRevision;
    void fitView({ padding: 0.2 });
  }, [fitView, sourceLayoutRevision]);

  const handleNodesChange = useCallback((changes: NodeChange[]) => {
    const nextCanvas = applyReactFlowNodeChanges(latestCanvasRef.current, changes);
    if (nextCanvas === latestCanvasRef.current) {
      return;
    }
    latestCanvasRef.current = nextCanvas;
    onCanvasChange(nextCanvas);
  }, [onCanvasChange]);

  const handleNodeDragStop = useCallback(() => {
    onCommit(latestCanvasRef.current);
  }, [onCommit]);

  const handleNodeNudge = useCallback((id: string, event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey) {
      return;
    }
    const distance = event.shiftKey ? 10 : 1;
    const deltas: Record<string, { x: number; y: number }> = {
      ArrowDown: { x: 0, y: distance },
      ArrowLeft: { x: -distance, y: 0 },
      ArrowRight: { x: distance, y: 0 },
      ArrowUp: { x: 0, y: -distance },
    };
    const delta = deltas[event.key];
    if (!delta) {
      return;
    }
    const currentCanvas = latestCanvasRef.current;
    const node = currentCanvas.nodes.find((candidate) => candidate.id === id);
    if (!node) {
      return;
    }
    event.preventDefault();
    const nextCanvas: FlowchartCanvasV1 = {
      ...currentCanvas,
      nodes: currentCanvas.nodes.map((candidate) => (
        candidate.id === id
          ? {
            ...candidate,
            position: {
              x: candidate.position.x + delta.x,
              y: candidate.position.y + delta.y,
            },
          }
          : candidate
      )),
    };
    latestCanvasRef.current = nextCanvas;
    onCanvasChange(nextCanvas);
    onCommit(nextCanvas);
  }, [onCanvasChange, onCommit]);

  const handleViewportMove = useCallback((event: unknown, viewport: { zoom: number }) => {
    if (event) {
      automaticFitRef.current = false;
    }
    setZoom(clampZoom(viewport.zoom));
  }, []);

  const zoomFromCenter = (delta: number) => {
    const nextZoom = clampZoom(zoom + delta);
    automaticFitRef.current = false;
    setZoom(nextZoom);
    void zoomTo(nextZoom);
  };

  const fitDiagram = () => {
    automaticFitRef.current = true;
    void fitView({ padding: 0.2 });
  };

  const resetZoom = () => {
    automaticFitRef.current = false;
    setZoom(1);
    void setViewport({ x: 0, y: 0, zoom: 1 });
  };

  const resetLayout = () => {
    automaticFitRef.current = true;
    onResetLayout();
  };

  return (
    <section className="flowchart-canvas" aria-label="Interactive flowchart">
      <div className="flowchart-canvas__toolbar" aria-label="Flowchart controls">
        <button
          type="button"
          className="preview-toolbar__button"
          aria-label="Zoom out"
          disabled={zoom <= MIN_ZOOM}
          onClick={() => zoomFromCenter(-ZOOM_STEP)}
        >
          −
        </button>
        <output className="preview-toolbar__zoom" role="status" aria-label="Zoom level">
          {Math.round(zoom * 100)}%
        </output>
        <button
          type="button"
          className="preview-toolbar__button"
          aria-label="Zoom in"
          disabled={zoom >= MAX_ZOOM}
          onClick={() => zoomFromCenter(ZOOM_STEP)}
        >
          +
        </button>
        <button
          type="button"
          className="preview-toolbar__button"
          aria-label="Fit diagram"
          onClick={fitDiagram}
        >
          Fit
        </button>
        <button
          type="button"
          className="preview-toolbar__button"
          aria-label="100%"
          onClick={resetZoom}
        >
          100%
        </button>
        <button
          type="button"
          className="preview-toolbar__button"
          aria-label="Reset layout"
          onClick={resetLayout}
        >
          Reset layout
        </button>
      </div>
      <div className="flowchart-canvas__viewport">
        <ReactFlow
          nodes={toReactFlowNodes(canvas, handleNodeNudge)}
          edges={toReactFlowEdges(canvas)}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          minZoom={MIN_ZOOM}
          maxZoom={MAX_ZOOM}
          panOnDrag
          panOnScroll
          zoomOnPinch
          zoomOnScroll={false}
          nodesConnectable={false}
          edgesReconnectable={false}
          deleteKeyCode={null}
          multiSelectionKeyCode={null}
          elementsSelectable
          nodesDraggable
          nodesFocusable
          disableKeyboardA11y
          edgesFocusable={false}
          selectNodesOnDrag={false}
          selectionOnDrag={false}
          onNodesChange={handleNodesChange}
          onNodeDragStop={handleNodeDragStop}
          onMove={handleViewportMove}
        />
      </div>
    </section>
  );
}

export function FlowchartCanvas(props: FlowchartCanvasProps): React.JSX.Element {
  return (
    <ReactFlowProvider>
      <FlowchartCanvasContents {...props} />
    </ReactFlowProvider>
  );
}
