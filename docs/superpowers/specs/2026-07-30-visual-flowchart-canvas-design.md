# Interactive Flowchart Canvas Design

**Date:** 2026-07-30
**Status:** Approved for written-spec review

## Goal

Turn Mermaid Workbench from a static Mermaid preview into a lightweight visual
thinking canvas for flowcharts. A user can import an existing Mermaid
flowchart, freely reposition its nodes, and keep every connected arrow attached
and rerouted while dragging. The exact visual arrangement persists without
depending on Mermaid's automatic layout.

Mermaid remains the import and export format. The interactive canvas becomes
the authoritative representation of the visual layout.

## V1 Scope

The first release covers:

- `flowchart` and `graph` diagrams that can be normalized into nodes and edges;
- an interactive React Flow canvas in the full editor;
- dragging individual nodes while connected edges update continuously;
- canvas zooming, panning, fit-to-view, and the existing 10%–400% zoom bounds;
- persistent node positions;
- an explicit `Reset layout` action that recomputes an automatic layout;
- explicit Mermaid re-import and unchanged `.mmd` export;
- migration of existing compatible flowcharts when they are first opened;
- preservation of the existing static Mermaid preview for unsupported diagrams.

The first release does not include:

- visually adding or deleting nodes;
- visually adding, deleting, or reconnecting edges;
- resizing nodes;
- multi-select, alignment guides, snapping, grouping, or subflow editing;
- exact manual placement for sequence, class, ER, state, mindmap, or other
  Mermaid diagram families;
- continuous two-way editing between the Mermaid textarea and canvas;
- hosted accounts, authentication, or multi-user workspaces.

Those exclusions keep the first release focused on the original problem:
rearranging a cramped automatically generated flowchart without losing its
relationships.

## Product Model

For a compatible flowchart, the saved diagram contains two related artifacts:

1. the imported Mermaid source, retained exactly for inspection, re-import,
   and `.mmd` export;
2. a versioned canvas document containing normalized nodes, edges, and node
   positions.

The canvas document is authoritative for what appears on the interactive
canvas. Mermaid source is not rerendered continuously while a user moves
nodes, and dragging never rewrites the source.

Because V1 does not visually change topology, the original Mermaid source can
be exported without lossy regeneration. A future release that adds visual
node and edge creation will introduce a deliberate Mermaid generator and make
the normalized graph authoritative for topology as well as layout.

## Compatible and Unsupported Mermaid

On opening a diagram without a saved canvas document, the client identifies
and parses the Mermaid source.

A diagram enters interactive mode only when:

- its type is `flowchart` or the equivalent `graph` form;
- its nodes have stable Mermaid identifiers;
- its relationships can be normalized into source and target node IDs;
- its constructs can be represented without discarding meaning.

V1 accepts ordinary nodes, node labels, common flowchart shapes, directed and
undirected relationships, and edge labels. The importer preserves the
original shape token and edge metadata needed to render and later export the
source unchanged.

Subgraphs, click handlers, external links, HTML labels, and constructs that
cannot be represented safely do not receive a partial or silently degraded
canvas. They continue to use the existing Mermaid SVG preview and show a
concise message that interactive layout is not yet available for that
diagram. The source and saved record remain unchanged.

The importer uses Mermaid's parsed flowchart model and immediately normalizes
it behind a Workbench-owned adapter. No editor component depends directly on
Mermaid's generated SVG structure. Contract tests pin the adapter behavior so
a Mermaid upgrade cannot silently change imported topology.

## Canvas Document

The shared model introduces a JSON-safe versioned document:

```ts
interface FlowchartCanvasV1 {
  kind: 'flowchart';
  version: 1;
  direction: 'TB' | 'BT' | 'LR' | 'RL';
  nodes: FlowchartNodeV1[];
  edges: FlowchartEdgeV1[];
}

interface FlowchartNodeV1 {
  id: string;
  label: string;
  shape: string;
  position: {
    x: number;
    y: number;
  };
}

interface FlowchartEdgeV1 {
  id: string;
  source: string;
  target: string;
  label?: string;
  arrowStart: boolean;
  arrowEnd: boolean;
  lineStyle: 'solid' | 'dotted' | 'thick' | 'invisible';
}
```

Node IDs come from explicit Mermaid identifiers, not rendered DOM IDs or
array positions. Edge IDs are deterministic from the parsed edge identity and
occurrence index so parallel edges remain distinct.

All coordinates must be finite numbers. Node and edge IDs must be unique, and
every edge endpoint must reference a node in the same document. Server-side
Zod schemas enforce these invariants before persistence or backup restore.

## Persistence and Migration

The `diagrams` table gains a nullable `canvas_json` column. Startup performs
an idempotent migration by inspecting the existing table before adding the
column. Existing databases remain readable without manual intervention.

`DiagramRecord` gains `canvas: FlowchartCanvasV1 | null`. Creating a legacy
Mermaid diagram initially stores `null`. Updating a compatible diagram can
atomically save its source, canvas document, title, and optimistic version.

The existing version-conflict behavior applies to canvas saves. A drag updates
local state continuously but persists once after drag stop through the normal
debounced save path. No network or database request occurs for every pointer
move.

Opening an existing compatible flowchart with `canvas: null` performs an
in-memory import and automatic layout. The first successful layout-changing
save persists the canvas. Merely viewing a diagram does not rewrite it.

Duplicate-diagram behavior copies the canvas so the duplicate starts with the
same arrangement. Full-library backup advances to version 2 and includes
canvas documents. Restore accepts both backup versions: version 1 diagrams
restore with `canvas: null`, and version 2 validates the complete canvas
before replacing any data.

## Interactive Canvas

The full editor uses `@xyflow/react` for compatible flowcharts. React Flow
owns the interactive node and edge presentation, while `EditorView` owns the
persisted draft and save lifecycle.

The canvas is controlled:

- nodes and edges come from the saved `FlowchartCanvasV1`;
- node-change events update the in-memory canvas;
- drag-stop marks the diagram dirty and schedules persistence;
- viewport changes remain view state and do not change diagram content;
- opening another diagram creates a fresh viewport and initially fits it.

The existing preview toolbar remains visually consistent. It controls the
React Flow viewport for zoom out, zoom percentage, zoom in, `Fit`, and `100%`.
Zoom remains clamped to the inclusive 10%–400% range.

Pointer intent is unambiguous:

- dragging a node moves that node;
- dragging blank canvas pans the viewport;
- a two-finger trackpad gesture pans;
- a trackpad pinch zooms;
- toolbar controls remain keyboard accessible.

The current source-collapse behavior remains. Collapsing or expanding the
source area resizes the canvas without resetting node positions or the user's
viewport.

## Nodes and Edges

Workbench supplies focused custom node components for common Mermaid
flowchart shapes, including rectangles, rounded rectangles, circles,
double-circles, diamonds, stadiums, subroutines, cylinders, and the core
polygonal shapes. A normalized but unrecognized shape is rendered as a
clearly styled rectangle while retaining its original shape token; the
importer reports that visual fallback instead of silently claiming an exact
match.

Each node exposes connection geometry on all four sides. A custom floating
edge chooses attachment sides from the relative node positions and computes
boundary intersections appropriate to each node shape. Therefore, moving a
node across another node causes its arrows to change attachment side rather
than stretching from a permanently fixed port.

Edges redraw during every React Flow node-position update. Arrow markers,
line style, and edge labels move with the route. The drag loop changes only
in-memory coordinates and DOM presentation; persistence occurs after the
gesture.

## Automatic and Manual Layout

Initial import uses a Workbench-owned automatic-layout adapter with the
diagram's Mermaid direction as a layout hint. The adapter returns node
positions without mutating the imported graph.

`Reset layout` recomputes every node position and fits the result. If the
current canvas contains manual position changes, the action asks for
confirmation because it replaces the arrangement. V1 does not add a general
undo system.

Explicit re-import reconciles positions by stable node ID:

- surviving node IDs retain their manual positions;
- new nodes receive automatic positions near their related nodes;
- removed node IDs and their position records disappear;
- a changed label or shape updates without moving the node;
- incompatible input leaves the existing canvas untouched.

The re-import preview reports added, removed, and preserved node counts before
replacement. Applying the import is a single versioned save.

## Mermaid Panel

For an interactive flowchart, the existing source panel becomes a Mermaid
import/export panel rather than a continuously live editor.

It shows the retained Mermaid source and provides:

- `Edit import` to stage source changes without affecting the canvas;
- `Apply import` to validate, preview reconciliation, and replace the canvas;
- `Cancel` to discard the staged text;
- `Copy Mermaid`;
- the existing `.mmd` download action.

The panel clearly states that moving nodes changes visual layout without
rewriting Mermaid. Syntax errors and unsupported constructs are shown before
the user can apply an import.

Unsupported diagram types continue using the current live Mermaid editor and
static preview so existing functionality is not removed while interactive
support expands incrementally.

## Component Boundaries

The implementation uses small, isolated units:

- `flowchart-import.ts` converts Mermaid's parsed flowchart model into the
  Workbench canvas model and compatibility result.
- `flowchart-canvas-schema.ts` defines shared TypeScript types and Zod
  validation.
- `flowchart-layout.ts` calculates automatic positions from normalized graph
  data.
- `FlowchartCanvas.tsx` adapts the controlled document and viewport to React
  Flow.
- `FlowchartNode.tsx` renders node shapes and accessible labels.
- `FloatingFlowchartEdge.tsx` calculates attachment points and routes.
- `MermaidImportPanel.tsx` owns staged import text and reconciliation review.
- `EditorView` chooses interactive or static mode and coordinates autosave,
  conflicts, duplication, and deletion.

The storage layer knows only validated JSON documents. It does not parse
Mermaid or calculate layout. The Mermaid adapter does not call the API or
write React state. The React Flow components do not know about SQLite.

## Saving and Conflict Handling

Canvas changes use the existing save-state reducer and optimistic version
number. A pending node-position save behaves like a pending source save:

- `Saving` appears after drag stop;
- `Saved` appears when the API returns the next version;
- a failed save keeps the local layout visible and offers retry;
- a version conflict presents the existing saved-versus-local choice.

Conflict details display a concise canvas summary rather than dumping large
JSON. Choosing the saved version replaces local node positions. Choosing the
local version force-saves the complete local canvas against the latest saved
version.

Navigating away waits for a pending save. If saving failed, the existing
leave-with-unsaved-changes confirmation remains.

## Error Handling and Data Safety

Import, migration, and re-import are transactional from the user's
perspective. The active diagram changes only after parsing, compatibility
checks, schema validation, and layout all succeed.

Invalid JSON from storage, non-finite coordinates, duplicate IDs, dangling
edges, or unsupported canvas versions produce a recoverable error and retain
the original Mermaid source. They never erase a diagram automatically.

The SVG-output editing approach is explicitly rejected. Generated Mermaid DOM
IDs and paths are renderer output rather than a stable editing contract.
Workbench operates on normalized graph data and React components instead.

## Accessibility and Responsive Behavior

Nodes are focusable and expose their labels. A selected node can be nudged
with arrow keys; holding Shift uses a larger increment. Keyboard movement
uses the same save path as pointer dragging.

Canvas controls have explicit accessible names and visible focus states.
Dragging is never the only way to reposition a node.

On narrow screens, the existing compact source bar remains above the canvas.
Touch panning and pinch zoom use React Flow's pointer handling, while node
dragging requires a deliberate press on a node rather than the background.

Reduced-motion preferences disable decorative transitions. Node movement
still follows direct user input without easing.

## Testing

Pure unit tests cover:

- canvas schema validation and all graph invariants;
- deterministic edge IDs, including parallel edges;
- Mermaid direction and common-shape normalization;
- compatibility rejection without partial output;
- stable-ID reconciliation for added, removed, and surviving nodes;
- automatic-layout results containing finite, non-overlapping positions;
- floating-edge attachment selection for all relative directions;
- backup version 1 migration and version 2 validation.

Component tests cover:

- node drag updating local coordinates;
- connected edge paths changing during drag;
- drag stop scheduling exactly one save;
- blank-canvas drag panning without moving nodes;
- zoom controls and 10%–400% limits;
- source collapse preserving node positions and viewport;
- reset-layout confirmation and result;
- import staging, validation, reconciliation, apply, and cancel;
- save failure, retry, and version-conflict choices;
- keyboard node movement and accessible labels;
- static fallback for unsupported Mermaid.

Storage and API tests cover:

- idempotent database migration;
- atomic canvas updates with version checking;
- duplication, backup, and restore;
- rejection of malformed or oversized canvas JSON.

The browser test imports a representative flowchart, drags a node, verifies
that a connected arrow moves, reloads the editor, and confirms the position
persists. It also checks reset layout and the unsupported-diagram fallback.

Manual Mac verification checks trackpad pan and pinch, node dragging at
several zoom levels, connection-side changes while crossing nodes, source
collapse, and persistence after reload.

## Delivery Sequence

Implementation proceeds in independently verifiable slices:

1. shared canvas model, validation, SQLite migration, API, and backup support;
2. Mermaid flowchart import and compatibility fallback;
3. automatic layout and stable-ID reconciliation;
4. React Flow canvas with node dragging and viewport controls;
5. floating edges, shape rendering, and edge labels;
6. autosave, conflicts, reset layout, and persistence;
7. Mermaid import panel and unchanged export;
8. browser verification, documentation, and final regression pass.

Each slice keeps the application buildable and preserves the existing static
preview until the interactive path is ready.

## Acceptance Criteria

The feature is complete when:

1. A compatible existing Mermaid flowchart opens as an interactive canvas.
2. Dragging a node moves only that node and updates all connected arrows
   continuously.
3. Dragging blank canvas pans without changing node coordinates.
4. Manual node positions survive autosave, reload, duplication, backup, and
   restore.
5. Zoom, pan, fit, 100%, and the 10%–400% clamp continue to work.
6. Reset layout replaces manual positions only after confirmation.
7. Mermaid re-import preserves surviving node positions and never replaces a
   valid canvas with invalid or unsupported input.
8. `.mmd` export preserves the imported Mermaid source exactly.
9. Unsupported Mermaid diagrams retain the existing editor and static
   preview without data loss.
10. No V1 UI allows visual node or edge creation, deletion, or reconnection.
11. Automated tests and the production build pass, followed by successful
    Mac trackpad verification.
