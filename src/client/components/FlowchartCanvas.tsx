import {
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type NodeChange,
  type NodeTypes,
} from '@xyflow/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type React from 'react';
import type { FlowchartCanvasV1 } from '../../shared/flowchart-canvas-schema';
import { FlowchartNode } from './FlowchartNode';
import {
  applyReactFlowNodeChanges,
  toReactFlowEdges,
  toReactFlowNodes,
} from './flowchart-react-flow';

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 4;
const ZOOM_STEP = 0.1;

const nodeTypes: NodeTypes = { flowchart: FlowchartNode };

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
          nodes={toReactFlowNodes(canvas)}
          edges={toReactFlowEdges(canvas)}
          nodeTypes={nodeTypes}
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
