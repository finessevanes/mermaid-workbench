# Interactive Flowchart Canvas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the full-editor preview for compatible Mermaid flowcharts with a persistent visual canvas whose nodes can be dragged while connected arrows reroute live.

**Architecture:** Keep imported Mermaid source unchanged for V1 import/export, normalize compatible flowcharts into a versioned Workbench-owned canvas document, and persist that document beside the source. Render compatible documents with controlled React Flow components; keep the current Mermaid SVG preview for unsupported diagrams.

**Tech Stack:** React 19, TypeScript 5.9, `@xyflow/react` 12.11.2, `@dagrejs/dagre` 3.0.0, Mermaid 11, Zod 4, `node:sqlite`, Vitest, Testing Library, Playwright.

## Global Constraints

- Support interactive layout only for compatible `flowchart` and `graph` diagrams in V1.
- Keep imported Mermaid source byte-for-byte unchanged during node movement and `.mmd` export.
- Do not add visual node creation, node deletion, edge creation, edge deletion, edge reconnection, resizing, grouping, snapping, or multi-selection.
- Persist finite node coordinates only; reject duplicate node IDs, duplicate edge IDs, and dangling edge endpoints.
- Preserve the existing static Mermaid editor and preview for unsupported diagram types and unsupported flowchart constructs.
- Keep zoom clamped to the inclusive range 10%–400%.
- A node drag updates local presentation continuously and performs one save after drag stop, never one save per pointer move.
- Preserve optimistic version conflicts, retry, pending-save navigation, duplication, backup, and restore behavior.
- Never edit generated Mermaid SVG paths or depend on generated SVG DOM IDs.
- Keep the server bound to loopback and preserve all existing security boundaries.
- Every behavior change follows red-green TDD and every task ends with a focused commit.

---

## File and Interface Map

### Shared and persistence

- `src/shared/flowchart-canvas-schema.ts`: versioned canvas types, Zod schemas, and invariants.
- `src/shared/flowchart-canvas-schema.test.ts`: schema and invariant unit tests.
- `src/shared/types.ts`: `DiagramRecord.canvas`, legacy backup V1, and canvas-aware backup V2.
- `src/server/schemas.ts`: create/update/backup request schemas that reuse the shared canvas schema.
- `src/server/storage.ts`: idempotent SQLite column migration and canvas persistence.
- `src/server/storage.test.ts`: migration, CRUD, duplication, backup, restore, and conflict tests.
- `src/server/http.test.ts`: canvas request/response and malformed-body tests.
- `src/client/api.ts`: canvas-aware update and backup types.

### Mermaid import and layout

- `src/client/mermaid-runtime.ts`: single Mermaid initialization boundary used by render and import.
- `src/client/flowchart-import.ts`: Mermaid-to-Workbench normalization and compatibility reporting.
- `src/client/flowchart-import.test.ts`: real-parser contract tests.
- `src/client/flowchart-layout.ts`: Dagre automatic layout and stable-ID reconciliation.
- `src/client/flowchart-layout.test.ts`: layout and reconciliation tests.
- `src/client/use-mermaid-preview.ts`: delegates initialization and rendering to `mermaid-runtime.ts`.

### Interactive canvas

- `src/client/components/flowchart-react-flow.ts`: pure conversion between canvas records and React Flow nodes/edges.
- `src/client/components/flowchart-react-flow.test.ts`: conversion and node-change tests.
- `src/client/components/FlowchartNode.tsx`: accessible common-shape node renderer and hidden connection handles.
- `src/client/components/FloatingFlowchartEdge.tsx`: shape-boundary attachment and edge route rendering.
- `src/client/components/floating-edge-geometry.ts`: pure boundary/intersection calculations.
- `src/client/components/floating-edge-geometry.test.ts`: geometry tests.
- `src/client/components/FlowchartCanvas.tsx`: controlled React Flow viewport, toolbar, drag, and reset UI.
- `src/client/components/FlowchartCanvas.test.tsx`: canvas interaction component tests.
- `src/client/components/MermaidImportPanel.tsx`: staged import and reconciliation UX.
- `src/client/components/MermaidImportPanel.test.tsx`: import panel tests.
- `src/client/components/EditorView.tsx`: interactive/static mode selection, draft state, autosave, and conflicts.
- `src/client/App.test.tsx`: editor integration and fallback tests.
- `src/client/styles.css`: Workbench-themed React Flow, node shape, import, and fallback styles.
- `src/client/main.tsx`: React Flow base stylesheet import.

### Browser and documentation

- `e2e/persistence.spec.ts`: drag, reroute, reload persistence, reset, and unsupported fallback.
- `README.md`: interactive flowchart behavior, compatibility, and current limitations.

---

### Task 1: Versioned Canvas Model and Dependencies

**Files:**
- Create: `src/shared/flowchart-canvas-schema.ts`
- Create: `src/shared/flowchart-canvas-schema.test.ts`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Produces:
  - `FLOWCHART_CANVAS_VERSION = 1`
  - `flowchartCanvasV1Schema: z.ZodType<FlowchartCanvasV1>`
  - `validateFlowchartCanvas(input: unknown): FlowchartCanvasV1`
  - `FlowchartCanvasV1`
  - `FlowchartNodeV1`
  - `FlowchartEdgeV1`
  - `FlowchartDirection`
  - `FlowchartLineStyle`

- [ ] **Step 1: Install the exact interactive-canvas dependencies**

Run:

```bash
npm install @xyflow/react@12.11.2 @dagrejs/dagre@3.0.0
```

Expected: `package.json` and `package-lock.json` add the two runtime
dependencies; `@dagrejs/dagre` supplies its own TypeScript declarations.

- [ ] **Step 2: Write failing schema and invariant tests**

Create tests with this representative valid value:

```ts
const validCanvas = {
  kind: 'flowchart',
  version: 1,
  direction: 'LR',
  nodes: [
    {
      id: 'idea',
      label: 'Idea',
      shape: 'rect',
      position: { x: 40, y: 80 },
    },
    {
      id: 'ship',
      label: 'Ship',
      shape: 'circle',
      position: { x: 340, y: 80 },
    },
  ],
  edges: [
    {
      id: 'idea-ship-0',
      source: 'idea',
      target: 'ship',
      arrowStart: false,
      arrowEnd: true,
      lineStyle: 'solid',
    },
  ],
} satisfies FlowchartCanvasV1;
```

Assert that it parses and that each of these inputs throws:

```ts
{ ...validCanvas, version: 2 }
{ ...validCanvas, nodes: [...validCanvas.nodes, validCanvas.nodes[0]] }
{ ...validCanvas, edges: [...validCanvas.edges, validCanvas.edges[0]] }
{ ...validCanvas, nodes: [{ ...validCanvas.nodes[0], position: { x: NaN, y: 0 } }] }
{ ...validCanvas, edges: [{ ...validCanvas.edges[0], target: 'missing' }] }
```

- [ ] **Step 3: Run the schema tests to verify they fail**

Run:

```bash
npm test -- src/shared/flowchart-canvas-schema.test.ts
```

Expected: FAIL because `flowchart-canvas-schema.ts` does not exist.

- [ ] **Step 4: Implement the strict versioned schema**

Define:

```ts
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
```

Use finite-number schemas, trimmed non-empty IDs capped at 240 characters,
labels capped at 20,000 characters, at most 5,000 nodes, and at most 10,000
edges. Add one `superRefine` that reports duplicate IDs and dangling endpoints.
`validateFlowchartCanvas` must call `.parse`.

- [ ] **Step 5: Run the schema tests and typecheck**

Run:

```bash
npm test -- src/shared/flowchart-canvas-schema.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit the model foundation**

```bash
git add package.json package-lock.json src/shared/flowchart-canvas-schema.ts src/shared/flowchart-canvas-schema.test.ts
git commit -m "feat: add versioned flowchart canvas model"
```

---

### Task 2: Canvas Persistence, Migration, and Backup V2

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/server/schemas.ts`
- Modify: `src/server/storage.ts`
- Modify: `src/server/storage.test.ts`
- Modify: `src/server/http.test.ts`
- Modify: `src/client/api.ts`

**Interfaces:**
- Consumes: `flowchartCanvasV1Schema`, `FlowchartCanvasV1`.
- Produces:
  - `DiagramRecord.canvas: FlowchartCanvasV1 | null`
  - `LibraryBackupV1` with legacy diagrams
  - `LibraryBackupV2` with current diagrams
  - `LibraryBackup = LibraryBackupV1 | LibraryBackupV2`
  - `updateDiagram(id, { canvas?, source?, title?, version, force? })`

- [ ] **Step 1: Write failing storage migration and canvas CRUD tests**

Add a helper that creates a legacy database before `WorkbenchStore` opens it:

```ts
const legacy = new DatabaseSync(databasePath);
legacy.exec(`
  CREATE TABLE projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  ) STRICT;
  CREATE TABLE diagrams (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    source TEXT NOT NULL,
    version INTEGER NOT NULL CHECK (version > 0),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  ) STRICT;
`);
legacy.close();
```

Assert:

- reopening adds `canvas_json` once and returns legacy diagrams with
  `canvas: null`;
- creating a diagram returns `canvas: null`;
- updating with `validCanvas` returns it and increments the version;
- duplicate copies `canvas`;
- a stale canvas update throws `VersionConflictError`;
- malformed canvas data is rejected before the record changes.

- [ ] **Step 2: Write failing backup compatibility tests**

Assert:

```ts
expect(store.exportBackup()).toMatchObject({
  format: 'mermaid-workbench-backup',
  version: 2,
});
```

Then restore:

- a literal version 1 backup whose diagram objects have no `canvas`;
- a version 2 backup containing `validCanvas`;
- an invalid version 2 backup with a dangling edge, verifying the existing
  library remains unchanged.

- [ ] **Step 3: Write failing HTTP tests**

Send `PUT /api/diagrams/:id` with `{ canvas: validCanvas, version: 1 }` and
expect a canvas-aware record. Send non-finite JSON alternatives that survive
JSON encoding, such as a string coordinate or a dangling endpoint, and expect
`400 INVALID_REQUEST`.

- [ ] **Step 4: Run focused persistence tests to verify they fail**

Run:

```bash
npm test -- src/server/storage.test.ts src/server/http.test.ts
```

Expected: FAIL because canvas fields and backup V2 do not exist.

- [ ] **Step 5: Add shared record and backup types**

Use:

```ts
export interface DiagramRecord {
  // existing fields
  canvas: FlowchartCanvasV1 | null;
}

export type LegacyDiagramRecordV1 = Omit<DiagramRecord, 'canvas'>;

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
```

Update client restore signatures to accept `LibraryBackup`.

- [ ] **Step 6: Add strict request and backup schemas**

Extend `diagramUpdateSchema` with:

```ts
canvas: flowchartCanvasV1Schema.nullable().optional(),
```

Count `canvas !== undefined` in the existing “at least one field” refinement.
Keep separate `backupV1Schema` and `backupV2Schema`, then export:

```ts
export const backupSchema = z.discriminatedUnion('version', [
  backupV1Schema,
  backupV2Schema,
]);
```

V1 diagram objects must remain strict and must not accept `canvas`.

- [ ] **Step 7: Implement idempotent SQLite migration and serialization**

After the existing `CREATE TABLE` transaction, inspect:

```ts
const diagramColumns = this.database
  .prepare('PRAGMA table_info(diagrams)')
  .all() as Array<{ name: string }>;
```

If `canvas_json` is absent, run:

```sql
ALTER TABLE diagrams ADD COLUMN canvas_json TEXT;
```

Select and map `canvas_json` everywhere. Parse non-null JSON with
`validateFlowchartCanvas`; serialize canvas with `JSON.stringify`. Update
`createDiagram`, `updateDiagram`, duplication, backup export, and restore.
Convert restored V1 diagrams to `canvas: null` before insertion. Keep backup
replacement inside the existing transaction.

- [ ] **Step 8: Run persistence tests and the full suite**

Run:

```bash
npm test -- src/server/storage.test.ts src/server/http.test.ts
npm test
npm run build
```

Expected: all commands PASS.

- [ ] **Step 9: Commit canvas persistence**

```bash
git add src/shared/types.ts src/server/schemas.ts src/server/storage.ts src/server/storage.test.ts src/server/http.test.ts src/client/api.ts
git commit -m "feat: persist flowchart canvas documents"
```

---

### Task 3: Mermaid Runtime and Compatible Flowchart Import

**Files:**
- Create: `src/client/mermaid-runtime.ts`
- Create: `src/client/flowchart-import.ts`
- Create: `src/client/flowchart-import.test.ts`
- Modify: `src/client/use-mermaid-preview.ts`
- Modify: `src/client/use-mermaid-preview.test.tsx`

**Interfaces:**
- Consumes: `FlowchartDirection`, `FlowchartEdgeV1`, `FlowchartLineStyle`.
- Produces:

```ts
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
  | { status: 'unsupported'; reason: string };

export async function importMermaidFlowchart(
  source: string,
): Promise<FlowchartImportResult>;
```

- [ ] **Step 1: Write real-Mermaid importer contract tests**

Use actual Mermaid input, not mocked parser output:

```ts
flowchart LR
  idea[Idea] -->|refine| decision{Ready?}
  decision -.-> ship((Ship))
```

Assert stable node IDs, labels, shapes, direction, edge endpoints, edge label,
arrow markers, and line styles. Add a parallel-edge case and assert distinct,
deterministic edge IDs.

Assert `unsupported` for:

- `sequenceDiagram`;
- a flowchart containing `subgraph`;
- a flowchart node with `click`;
- an HTML label;
- syntactically invalid Mermaid.

Invalid syntax must return an unsupported reason and must not throw out of
`importMermaidFlowchart`.

- [ ] **Step 2: Run importer tests to verify they fail**

Run:

```bash
npm test -- src/client/flowchart-import.test.ts
```

Expected: FAIL because the importer does not exist.

- [ ] **Step 3: Extract one Mermaid initialization boundary**

Move the existing strict security configuration into:

```ts
export async function getMermaid() {
  const { default: mermaid } = await import('mermaid');
  if (!initialized) {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: 'base',
      themeVariables: {
        primaryColor: '#e9efff',
        primaryBorderColor: '#2f5ee5',
        primaryTextColor: '#111a2d',
        lineColor: '#526078',
        secondaryColor: '#fff4d6',
        tertiaryColor: '#f4f6fa',
        fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
      },
    });
    initialized = true;
  }
  return mermaid;
}
```

Update `defaultMermaidRenderer` to call `getMermaid()` and keep its existing
observable behavior and tests.

- [ ] **Step 4: Implement the Workbench-owned importer adapter**

Call `mermaid.mermaidAPI.getDiagramFromText(source)`, require a flowchart type,
and narrow the database behind runtime guards for `getData` and
`getSubGraphs`. Reject subgraphs and interactive callbacks before returning
data.

Normalize node IDs from Mermaid model IDs, never DOM IDs. Map direction to
`TB | BT | LR | RL`; default an absent direction to `TB`. Map line style
exactly:

```ts
const lineStyle = {
  normal: 'solid',
  dotted: 'dotted',
  thick: 'thick',
  invisible: 'invisible',
} as const;
```

Construct edge IDs as:

```ts
`${encodeURIComponent(source)}-${encodeURIComponent(target)}-${occurrence}`
```

where `occurrence` increments for every edge with the same endpoints. Catch
parse or contract failures and return a concise `unsupported` result.

- [ ] **Step 5: Run importer, preview, and type tests**

Run:

```bash
npm test -- src/client/flowchart-import.test.ts src/client/use-mermaid-preview.test.tsx
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit the import boundary**

```bash
git add src/client/mermaid-runtime.ts src/client/flowchart-import.ts src/client/flowchart-import.test.ts src/client/use-mermaid-preview.ts src/client/use-mermaid-preview.test.tsx
git commit -m "feat: import compatible Mermaid flowcharts"
```

---

### Task 4: Automatic Layout and Stable-ID Reconciliation

**Files:**
- Create: `src/client/flowchart-layout.ts`
- Create: `src/client/flowchart-layout.test.ts`

**Interfaces:**
- Consumes: `ImportedFlowchart`, `FlowchartCanvasV1`.
- Produces:

```ts
export interface ReconciliationSummary {
  added: number;
  removed: number;
  preserved: number;
}

export function layoutImportedFlowchart(
  graph: ImportedFlowchart,
): FlowchartCanvasV1;

export function reconcileFlowchartImport(
  previous: FlowchartCanvasV1,
  graph: ImportedFlowchart,
): {
  canvas: FlowchartCanvasV1;
  summary: ReconciliationSummary;
};
```

- [ ] **Step 1: Write failing automatic-layout tests**

Build LR, TB, BT, and RL imported graphs. Assert every returned coordinate is
finite and pairwise node rectangles do not overlap. For an LR graph, assert
the target center is to the right of the source center; for TB, below it.

Use one shared sizing function:

```ts
export function flowchartNodeSize(shape: string, label: string) {
  const width = Math.min(260, Math.max(120, 56 + label.length * 7));
  const height = shape === 'circle' || shape === 'doublecircle'
    ? Math.max(88, Math.min(160, width))
    : 72;
  return { width, height };
}
```

- [ ] **Step 2: Write failing reconciliation tests**

Start with nodes `a`, `b`, and `removed` at distinctive coordinates. Import
`a`, renamed `b`, and new node `c`. Assert:

- `a` and `b` keep exact positions;
- `b` receives its new label and shape;
- `removed` disappears;
- `c` receives a finite automatic position;
- summary equals `{ added: 1, removed: 1, preserved: 2 }`;
- edges exactly match the new imported topology.

- [ ] **Step 3: Run layout tests to verify they fail**

Run:

```bash
npm test -- src/client/flowchart-layout.test.ts
```

Expected: FAIL because layout functions do not exist.

- [ ] **Step 4: Implement Dagre layout**

Create a new `dagre.graphlib.Graph`, call `setGraph` with:

```ts
{
  rankdir: graph.direction,
  ranksep: 90,
  nodesep: 64,
  edgesep: 32,
  marginx: 40,
  marginy: 40,
}
```

Set node width/height from `flowchartNodeSize`, set all edges, run
`dagre.layout`, and convert Dagre center coordinates to React Flow top-left
coordinates.

- [ ] **Step 5: Implement stable-ID reconciliation**

Layout the new graph once, then replace each surviving node's generated
position with its previous position. Leave new nodes at generated positions.
Return exact added/removed/preserved counts from ID sets.

- [ ] **Step 6: Run layout tests and typecheck**

Run:

```bash
npm test -- src/client/flowchart-layout.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit layout and reconciliation**

```bash
git add src/client/flowchart-layout.ts src/client/flowchart-layout.test.ts
git commit -m "feat: lay out and reconcile flowchart imports"
```

---

### Task 5: Controlled React Flow Canvas and Viewport

**Files:**
- Create: `src/client/components/flowchart-react-flow.ts`
- Create: `src/client/components/flowchart-react-flow.test.ts`
- Create: `src/client/components/FlowchartNode.tsx`
- Create: `src/client/components/FlowchartCanvas.tsx`
- Create: `src/client/components/FlowchartCanvas.test.tsx`
- Modify: `src/client/main.tsx`
- Modify: `src/client/styles.css`

**Interfaces:**
- Consumes: `FlowchartCanvasV1`, `flowchartNodeSize`.
- Produces:

```ts
export interface FlowchartCanvasProps {
  canvas: FlowchartCanvasV1;
  sourceLayoutRevision?: number;
  onCanvasChange: (canvas: FlowchartCanvasV1) => void;
  onCommit: (canvas: FlowchartCanvasV1) => void;
  onResetLayout: () => void;
}

export function toReactFlowNodes(
  canvas: FlowchartCanvasV1,
): Node<FlowchartNodeData>[];

export function applyReactFlowNodeChanges(
  canvas: FlowchartCanvasV1,
  changes: NodeChange[],
): FlowchartCanvasV1;
```

- [ ] **Step 1: Write failing pure adapter tests**

Assert conversion preserves IDs, labels, shapes, and positions. Apply a React
Flow position change:

```ts
[{ id: 'idea', type: 'position', position: { x: 210, y: 130 }, dragging: true }]
```

Assert only node `idea` changes and the input canvas is not mutated. Filter
`remove`, `add`, `replace`, `dimensions`, and `select` changes so V1 cannot
alter topology through React Flow.

- [ ] **Step 2: Write failing component interaction tests**

Render `FlowchartCanvas` with two nodes and one edge. Assert:

- the region is named `Interactive flowchart`;
- the zoom toolbar exposes Zoom out, Zoom level, Zoom in, Fit diagram, 100%,
  and Reset layout;
- `minZoom` and `maxZoom` are reflected by disabled buttons at 10% and 400%;
- a node position change calls `onCanvasChange`;
- drag stop calls `onCommit` once with the latest canvas;
- a pane drag does not call `onCanvasChange` or `onCommit`;
- clicking Reset layout calls `onResetLayout`.

Use a small test mock of `@xyflow/react` only for event determinism; keep the
pure adapter tests against real React Flow types.

- [ ] **Step 3: Run focused canvas tests to verify they fail**

Run:

```bash
npm test -- src/client/components/flowchart-react-flow.test.ts src/client/components/FlowchartCanvas.test.tsx
```

Expected: FAIL because the canvas files do not exist.

- [ ] **Step 4: Implement the controlled canvas**

Import `@xyflow/react/dist/style.css` once in `main.tsx`. Wrap the internal
canvas with `ReactFlowProvider` and configure:

```tsx
<ReactFlow
  nodes={nodes}
  edges={edges}
  nodeTypes={nodeTypes}
  minZoom={0.1}
  maxZoom={4}
  panOnDrag
  panOnScroll
  zoomOnPinch
  zoomOnScroll={false}
  nodesConnectable={false}
  deleteKeyCode={null}
  multiSelectionKeyCode={null}
  elementsSelectable
  onNodesChange={handleNodesChange}
  onNodeDragStop={handleNodeDragStop}
  onMove={handleViewportMove}
/>
```

Use `useReactFlow()` for `zoomTo`, `fitView`, and `setViewport`. Preserve the
existing toolbar labels and percentage presentation. Keep source-layout
resize handling by calling `fitView` only while the viewport remains in
automatic-fit mode. `toReactFlowNodes` sets `deletable: false` and
`connectable: false` on every node.

- [ ] **Step 5: Implement the basic accessible node**

Render a focusable node with:

```tsx
<div
  className={`flowchart-node flowchart-node--${safeShapeClass(shape)}`}
  aria-label={label}
  tabIndex={0}
>
  <Handle type="target" position={Position.Top} className="flowchart-handle" />
  <span>{label}</span>
  <Handle type="source" position={Position.Bottom} className="flowchart-handle" />
</div>
```

Size it from `flowchartNodeSize`. The handles remain visually hidden but
available to React Flow. Add Workbench colors, focus, selected, cursor, grid,
and responsive styles without changing library-card previews.

- [ ] **Step 6: Run canvas tests and build**

Run:

```bash
npm test -- src/client/components/flowchart-react-flow.test.ts src/client/components/FlowchartCanvas.test.tsx
npm run build
```

Expected: PASS.

- [ ] **Step 7: Commit the controlled canvas**

```bash
git add src/client/components/flowchart-react-flow.ts src/client/components/flowchart-react-flow.test.ts src/client/components/FlowchartNode.tsx src/client/components/FlowchartCanvas.tsx src/client/components/FlowchartCanvas.test.tsx src/client/main.tsx src/client/styles.css
git commit -m "feat: add controlled interactive flowchart canvas"
```

---

### Task 6: Shape-Aware Floating Edges and Keyboard Movement

**Files:**
- Create: `src/client/components/floating-edge-geometry.ts`
- Create: `src/client/components/floating-edge-geometry.test.ts`
- Create: `src/client/components/FloatingFlowchartEdge.tsx`
- Modify: `src/client/components/FlowchartNode.tsx`
- Modify: `src/client/components/FlowchartCanvas.tsx`
- Modify: `src/client/components/FlowchartCanvas.test.tsx`
- Modify: `src/client/components/flowchart-react-flow.ts`
- Modify: `src/client/styles.css`

**Interfaces:**
- Consumes: React Flow `InternalNode`, `EdgeProps`; node shape and size.
- Produces:

```ts
export interface Point {
  x: number;
  y: number;
}

export function nodeBoundaryPoint(
  center: Point,
  size: { width: number; height: number },
  shape: string,
  toward: Point,
): Point;

export function floatingEdgeEndpoints(
  source: NodeGeometry,
  target: NodeGeometry,
): {
  source: Point;
  target: Point;
  sourcePosition: Position;
  targetPosition: Position;
};
```

- [ ] **Step 1: Write failing boundary geometry tests**

For a rectangle, circle, and diamond centered at `{ x: 100, y: 100 }`, assert
the boundary point toward targets directly right, left, above, below, and
diagonally. Assert every result is finite and lies on the expected boundary.
Assert swapping source and target causes attachment sides to swap.

- [ ] **Step 2: Write failing edge and keyboard component tests**

Assert:

- moving a connected node changes the rendered edge path `d`;
- moving a node across its neighbor changes the attachment sides;
- dotted, thick, invisible, start-arrow, and end-arrow metadata map to edge
  classes and markers;
- edge labels remain present after movement;
- ArrowRight on a focused node commits `x + 1`;
- Shift+ArrowDown commits `y + 10`;
- keyboard movement does not change topology.

- [ ] **Step 3: Run focused tests to verify they fail**

Run:

```bash
npm test -- src/client/components/floating-edge-geometry.test.ts src/client/components/FlowchartCanvas.test.tsx
```

Expected: FAIL because floating edges and keyboard movement are absent.

- [ ] **Step 4: Implement shape-boundary geometry**

Use ray intersection from a node center toward the opposite center:

- rectangle/subroutine/stadium/cylinder/fallback: intersect the rectangle;
- circle/doublecircle: normalize the vector to the radius;
- diamond: scale by `1 / (abs(dx)/(width/2) + abs(dy)/(height/2))`;
- polygonal shapes: use the fallback rectangle in V1 while retaining the
  shape-specific visual class.

Map the dominant direction of the resulting vector to React Flow
`Position.Left | Right | Top | Bottom`.

- [ ] **Step 5: Implement the custom floating edge**

Use `useInternalNode(source)` and `useInternalNode(target)`, compute endpoints,
then call `getBezierPath`. Render:

```tsx
<>
  <BaseEdge
    id={id}
    path={edgePath}
    markerStart={markerStart}
    markerEnd={markerEnd}
    className={`flowchart-edge flowchart-edge--${lineStyle}`}
  />
  {label ? (
    <EdgeLabelRenderer>
      <span
        className="flowchart-edge__label"
        style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
      >
        {label}
      </span>
    </EdgeLabelRenderer>
  ) : null}
</>
```

Register the edge type and include source/target node IDs and metadata in edge
data.

- [ ] **Step 6: Implement keyboard nudging**

On a node keydown, handle only unmodified arrow keys and Shift+arrow. Convert
the key to a `{ x, y }` delta of 1 or 10, update that node in a copied canvas,
then call both `onCanvasChange` and `onCommit` once. Prevent default page
scrolling only for handled keys.

- [ ] **Step 7: Run geometry, canvas, and build checks**

Run:

```bash
npm test -- src/client/components/floating-edge-geometry.test.ts src/client/components/FlowchartCanvas.test.tsx
npm run build
```

Expected: PASS.

- [ ] **Step 8: Commit dynamic edges and keyboard movement**

```bash
git add src/client/components/floating-edge-geometry.ts src/client/components/floating-edge-geometry.test.ts src/client/components/FloatingFlowchartEdge.tsx src/client/components/FlowchartNode.tsx src/client/components/FlowchartCanvas.tsx src/client/components/FlowchartCanvas.test.tsx src/client/components/flowchart-react-flow.ts src/client/styles.css
git commit -m "feat: reroute flowchart edges during node movement"
```

---

### Task 7: Editor Mode, Autosave, Reset, and Conflicts

**Files:**
- Modify: `src/client/components/EditorView.tsx`
- Modify: `src/client/components/Dialog.tsx`
- Modify: `src/client/App.test.tsx`
- Modify: `src/client/save-state.test.ts`
- Modify: `src/client/styles.css`

**Interfaces:**
- Consumes: importer, layout, `FlowchartCanvas`, canvas-aware API.
- Produces editor states:

```ts
type DiagramPresentation =
  | { mode: 'loading' }
  | { mode: 'interactive'; canvas: FlowchartCanvasV1; transient: boolean }
  | { mode: 'static'; reason: string };
```

- [ ] **Step 1: Write failing compatible/unsupported editor tests**

For a compatible legacy flowchart with `canvas: null`, assert:

- the editor eventually renders `Interactive flowchart`;
- viewing it does not call `updateDiagram`;
- dragging through the canvas callback marks dirty and saves one canvas;
- the saved record version replaces the local version.

For a sequence diagram and a subgraph flowchart, assert the existing Mermaid
preview and source editor remain visible with an `Interactive layout
unavailable` explanation.

- [ ] **Step 2: Write failing persistence and reset tests**

Assert:

- reopening a record with saved canvas uses its exact positions without
  rerunning automatic layout;
- collapsing and expanding source preserves the same canvas positions;
- Reset layout asks `window.confirm`;
- cancel leaves positions unchanged;
- confirm applies `layoutImportedFlowchart`, marks dirty, fits, and saves once;
- save failure retains local positions and Retry resubmits them;
- choosing the saved conflict version replaces local canvas;
- force-saving the local conflict version submits the complete canvas.

- [ ] **Step 3: Run editor integration tests to verify they fail**

Run:

```bash
npm test -- src/client/App.test.tsx src/client/save-state.test.ts
```

Expected: FAIL because the editor has no interactive mode.

- [ ] **Step 4: Add canvas-aware editor draft state**

Extend:

```ts
interface Draft {
  title: string;
  source: string;
  canvas: FlowchartCanvasV1 | null;
  version: number;
}
```

On diagram ID change:

- if `diagram.canvas` exists, validate and enter interactive mode immediately;
- otherwise call `importMermaidFlowchart`;
- if compatible, lay it out in memory and mark `transient: true`;
- if unsupported, retain static mode and reason;
- ignore stale async import results after switching diagrams.

Do not mark a transient imported canvas dirty until the user drags, resets, or
applies an import.

- [ ] **Step 5: Route canvas commits through existing autosave**

`onCanvasChange` updates local draft only. `onCommit` updates the same draft
and dispatches `EDITED`. Extend `save` to submit `canvas` together with title
and source. Preserve pending-save navigation and retry behavior.

For conflict presentation, render:

```ts
function canvasSummary(canvas: FlowchartCanvasV1 | null) {
  return canvas
    ? `${canvas.nodes.length} nodes · ${canvas.edges.length} edges`
    : 'No interactive layout';
}
```

Do not dump JSON into the dialog.

- [ ] **Step 6: Implement reset and static fallback**

Reset asks:

```text
Reset all manually positioned nodes to an automatic layout?
```

On confirm, import the retained source, require compatibility, call
`layoutImportedFlowchart`, set the draft, dispatch `EDITED`, and tell
`FlowchartCanvas` to fit after the new document is rendered.

Static mode keeps `PreviewViewport` and its source behavior unchanged. Show
the reason near the Preview heading without using an alert role.

- [ ] **Step 7: Run editor, full tests, and build**

Run:

```bash
npm test -- src/client/App.test.tsx src/client/save-state.test.ts
npm test
npm run build
```

Expected: PASS.

- [ ] **Step 8: Commit editor integration**

```bash
git add src/client/components/EditorView.tsx src/client/components/Dialog.tsx src/client/App.test.tsx src/client/save-state.test.ts src/client/styles.css
git commit -m "feat: integrate persistent flowchart canvas"
```

---

### Task 8: Explicit Mermaid Import Panel

**Files:**
- Create: `src/client/components/MermaidImportPanel.tsx`
- Create: `src/client/components/MermaidImportPanel.test.tsx`
- Modify: `src/client/components/EditorView.tsx`
- Modify: `src/client/App.test.tsx`
- Modify: `src/client/styles.css`

**Interfaces:**
- Consumes: `importMermaidFlowchart`, `reconcileFlowchartImport`.
- Produces:

```ts
export interface MermaidImportPanelProps {
  source: string;
  canvas: FlowchartCanvasV1;
  onApply: (result: {
    source: string;
    canvas: FlowchartCanvasV1;
    summary: ReconciliationSummary;
  }) => void;
}
```

- [ ] **Step 1: Write failing import panel tests**

Assert:

- initial source is read-only and moving nodes never changes it;
- Edit import opens an editable textarea with a copy of the source;
- Cancel restores read-only source and changes nothing;
- invalid Mermaid shows a syntax error and disables Apply;
- unsupported Mermaid shows its compatibility reason and disables Apply;
- compatible changes show exact added/removed/preserved counts;
- Apply requires confirmation when removed is greater than zero;
- Apply calls `onApply` once with reconciled canvas and exact staged source;
- Copy Mermaid writes the full source and reports Copied/Copy failed;
- pointer down on panel controls does not pan the canvas.

- [ ] **Step 2: Run panel tests to verify they fail**

Run:

```bash
npm test -- src/client/components/MermaidImportPanel.test.tsx
```

Expected: FAIL because the panel does not exist.

- [ ] **Step 3: Implement staged import state**

Use:

```ts
type ImportState =
  | { mode: 'view' }
  | { mode: 'edit'; source: string; checking: boolean; result: null }
  | {
      mode: 'edit';
      source: string;
      checking: false;
      result: FlowchartImportResult;
    };
```

Debounce compatibility checking by 220 ms. Apply only a compatible result.
Call `reconcileFlowchartImport` before displaying counts. Confirm with:

```text
This import removes N node(s) from the visual canvas. Apply it?
```

when `removed > 0`.

- [ ] **Step 4: Replace the interactive source form only**

In interactive mode, retain the collapsible source rail but render
`MermaidImportPanel` instead of the live source textarea. Keep the title input
and source statistics. Applying an import updates `draft.source`,
`draft.canvas`, dispatches `EDITED`, and saves them atomically.

Static mode continues to render the existing live source textarea and Mermaid
preview.

- [ ] **Step 5: Run panel and editor tests**

Run:

```bash
npm test -- src/client/components/MermaidImportPanel.test.tsx src/client/App.test.tsx
npm run build
```

Expected: PASS.

- [ ] **Step 6: Commit explicit import UX**

```bash
git add src/client/components/MermaidImportPanel.tsx src/client/components/MermaidImportPanel.test.tsx src/client/components/EditorView.tsx src/client/App.test.tsx src/client/styles.css
git commit -m "feat: add explicit Mermaid flowchart import"
```

---

### Task 9: Browser Verification, Documentation, and Main Push

**Files:**
- Modify: `e2e/persistence.spec.ts`
- Modify: `README.md`

**Interfaces:**
- Consumes the complete interactive flowchart feature.
- Produces user-facing documentation and an end-to-end regression.

- [ ] **Step 1: Write the failing browser scenario**

Extend the persisted flowchart test to:

1. create `flowchart LR\n  idea[Idea] --> ship((Ship))`;
2. open the diagram and wait for `Interactive flowchart`;
3. record the bounding box of node `idea` and the `d` value of edge
   `idea-ship-0`;
4. drag node `idea` by at least 120 CSS pixels;
5. assert its bounding box and connected edge path both changed;
6. reload and assert the node returns at the dragged position within a
   two-pixel tolerance;
7. click Reset layout, confirm, and assert its position changes;
8. create a sequence diagram and assert it uses the static Mermaid preview
   with the unsupported explanation.

Use React Flow node attributes:

```ts
const ideaNode = page.locator('.react-flow__node[data-id="idea"]');
const edgePath = page.locator('.react-flow__edge[data-id="idea-ship-0"] path');
```

- [ ] **Step 2: Run the browser test to verify any missing behavior fails**

Run:

```bash
npm run test:e2e
```

Expected before final fixes: FAIL at the first unmet acceptance assertion, or
PASS if all prior slices already satisfy the complete browser contract.

- [ ] **Step 3: Fix only browser-discovered integration gaps**

Limit fixes to the failing acceptance path. Add a focused component or pure
unit test for each discovered regression before modifying implementation.
Do not add visual topology editing or other V1-excluded features.

- [ ] **Step 4: Update the README**

Document:

- compatible flowcharts open as draggable visual canvases;
- node positions persist separately from Mermaid;
- edges reroute while dragging;
- Reset layout returns to automatic layout;
- interactive Mermaid changes use explicit Edit import / Apply import;
- unsupported diagrams continue in static Mermaid mode;
- V1 does not visually add, delete, or reconnect nodes and edges.

Keep the loopback-only public-internet warning unchanged.

- [ ] **Step 5: Run the complete verification gate**

Run:

```bash
npm test
npm run typecheck
npm run build
npm run test:e2e
git diff --check
git status --short
```

Expected:

- all Vitest files pass with zero failures;
- TypeScript exits 0;
- Vite production build exits 0;
- Playwright exits 0;
- no whitespace errors;
- only the intended README, e2e, and any browser-fix files are uncommitted.

- [ ] **Step 6: Commit final verification and documentation**

```bash
git add e2e/persistence.spec.ts README.md
git commit -m "test: verify interactive flowchart canvas"
```

If Step 3 produced a regression fix, commit that fix and its focused test
separately before this documentation commit, staging only the exact paths
shown by `git status --short`.

- [ ] **Step 7: Push the verified history directly to main**

Run:

```bash
git push origin HEAD:main
```

Expected: the reviewed task commits advance `origin/main`; no feature branch
or pull request is created.

- [ ] **Step 8: Verify GitHub Actions**

Run:

```bash
gh run list --repo finessevanes/mermaid-workbench --branch main --limit 1
gh run watch <run-id> --repo finessevanes/mermaid-workbench --exit-status
```

Expected: both `verify` and `browser` jobs conclude `success`.

- [ ] **Step 9: Perform Mac interaction verification**

In the locally running app verify:

- two-finger pan moves the viewport rather than a node;
- pinch zoom stays within 10%–400%;
- dragging a node at 50%, 100%, and 200% tracks the pointer;
- crossing one node past another changes edge attachment sides;
- collapsing and expanding source preserves layout and viewport;
- reload restores the dragged node positions.

Record any hardware-only discrepancy before claiming completion.
