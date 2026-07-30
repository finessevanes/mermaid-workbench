# Editor Source Rail and Preview Navigation Design

**Date:** 2026-07-29
**Status:** Approved

## Goal

Give the diagram preview substantially more room while making Mermaid diagrams easy to inspect with a Mac trackpad or mouse. The source editor must collapse into a narrow, recoverable rail, and the preview must support bounded zooming and panning without changing or saving diagram content.

## Scope

This change covers:

- collapsing and expanding the source panel;
- a narrow desktop source rail and compact narrow-screen source bar;
- trackpad pinch zoom, two-finger pan, and mouse drag pan;
- visible zoom controls, fit-to-view, and 100% reset;
- hard zoom limits from 10% through 400%;
- predictable behavior during rendering, syntax errors, resizing, and diagram changes;
- keyboard and screen-reader access to every visible control.

It does not cover:

- persisting view settings in SQLite or exported diagrams;
- editing Mermaid nodes directly in the preview;
- minimaps, selection, infinite-canvas objects, or touch-screen multi-pointer gestures;
- distinguishing an exact three-finger macOS gesture, which browsers do not expose reliably.

## Source Panel

The expanded source panel keeps its current title field, Mermaid textarea, line count, character count, and autosave behavior. Its header gains a clearly labelled collapse button.

On desktop widths above the existing single-column breakpoint, collapsing the panel replaces it with a narrow vertical rail on the left side of the preview. The rail contains:

- an expand button with the accessible name `Expand source`;
- a vertical `Source` label;
- a syntax-error indicator when the current draft is invalid.

The preview consumes the released width immediately. Collapsing only hides the form visually; it does not unmount the draft state, interrupt rendering, cancel autosave, reset the preview transform, or move focus unpredictably. After collapsing, focus moves to the expand button. After expanding, focus returns to the collapse button.

At widths where the workspace already uses one column, the collapsed representation becomes a short horizontal `Show source` bar above the preview instead of a vertical rail. This avoids using scarce horizontal space on phones and narrow windows.

The collapsed state lasts only for the current mounted editor session. Opening another diagram starts with the source expanded. It is not written into a diagram record, backup, or browser storage.

## Preview Viewport

The preview becomes a clipped viewport containing a transformable SVG layer. Its transform is represented as:

```ts
interface ViewportTransform {
  x: number;
  y: number;
  scale: number;
}
```

The diagram uses one CSS transform combining translation and scale. The SVG is allowed to render at its intrinsic Mermaid dimensions rather than being permanently constrained by `max-width` and `max-height`.

The viewport supports these interactions:

- a trackpad pinch zooms around the gesture location;
- a two-finger trackpad slide pans using the supplied wheel deltas;
- click-and-drag pans with pointer capture and `grab`/`grabbing` cursor feedback;
- zoom-out and zoom-in buttons change the scale in predictable increments;
- `Fit` computes the largest bounded scale that shows the complete SVG with comfortable padding, then centers it;
- `100%` sets scale to 1 and centers the SVG.

Trackpad pinch is handled from a wheel event carrying the browser's pinch modifier. Ordinary wheel deltas pan the canvas. The wheel listener is non-passive so browser page zoom or page scrolling is prevented only while the pointer is over the preview and the gesture is being consumed. Interactions elsewhere in the application keep their normal browser behavior.

Zoom is clamped to the inclusive range 10%–400% after every gesture or control action. There is no elastic overshoot. Zoom buttons become disabled at their respective limits, and the displayed percentage always reports the clamped result. The hard clamp is the requested zoom lock; there is no separate lock-mode toggle.

The zoom toolbar appears in the preview header and contains, in order:

- zoom out;
- the current zoom percentage;
- zoom in;
- `Fit`;
- `100%`.

All toolbar controls have explicit accessible names, visible focus states, and native button semantics. The percentage is exposed as a polite status value. Preview navigation never changes Mermaid source, save state, diagram version, or database data.

## Viewport Lifecycle

The first valid render for a newly opened diagram fits and centers the SVG. Switching to another diagram creates a fresh viewport and fits that diagram.

After the initial fit:

- valid source edits preserve the user's current scale and pan position;
- an invalid source preserves both the last valid SVG and its transform;
- returning to valid source replaces the SVG without discarding the transform;
- collapsing or expanding the source preserves the transform;
- resizing the viewport recomputes the transform only while the viewport remains in automatic fit mode;
- manual zooming, panning, dragging, or choosing `100%` exits automatic fit mode;
- choosing `Fit` re-enters automatic fit mode.

If a new valid SVG has no measurable bounds on its first layout frame, measurement is retried on the next animation frame. Until measurement succeeds, the last valid display remains in place or the existing rendering placeholder is shown.

## Components and Boundaries

`EditorView` continues to own the diagram draft, autosave state, render state, conflicts, and source-collapsed state. It decides which source representation to show and passes the rendered SVG and render status to the preview.

A focused `PreviewViewport` component owns DOM measurements, transform state, fit mode, gesture listeners, pointer capture, and the preview toolbar. It receives rendered SVG, loading state, and error text. It does not know about the API, drafts, autosave, or diagram persistence.

A small pure viewport-transform module owns:

- scale clamping;
- zoom-at-point calculations;
- pan calculations;
- centering at 100%;
- fit-to-bounds calculations.

The pure functions accept numbers and rectangles and return a transform. This keeps browser event handling separate from transform mathematics and makes zoom anchoring and boundary behavior deterministic to test.

The existing preview hook remains responsible for debounced Mermaid rendering and retaining the last valid SVG when a render fails. The reusable compact library-card preview keeps its current non-interactive behavior; navigation controls apply only to the full editor preview.

## Error Handling

Mermaid syntax errors continue to appear in the preview alert and continue to block autosave. When the source is collapsed, the rail or compact source bar also exposes a visible error marker so the user knows where to return.

Gesture or measurement failures must not clear the SVG or modify the draft. If SVG bounds cannot be measured, viewport controls remain available, but `Fit` is disabled until measurable content exists. A zero-sized container is treated as temporarily unavailable and retried after resize rather than producing `NaN` or infinite transforms.

Pointer capture is released on pointer up, pointer cancel, component unmount, or loss of capture. The viewport must never remain stuck in a dragging state.

## Responsive and Motion Behavior

The desktop vertical rail follows the existing workspace breakpoint so the source and preview remain side by side only where there is adequate room. The narrow-screen horizontal bar preserves the existing source-above-preview order.

Transform updates follow the pointer or trackpad directly and do not use decorative easing. Existing reduced-motion preferences continue to disable unrelated transitions and animations. Gesture handling is scoped to the preview surface, so the surrounding page remains scrollable on narrow screens when the gesture begins outside the preview.

## Testing

Unit tests for the pure transform module cover:

- minimum and maximum scale clamping;
- zooming around a focal point without moving that point on screen;
- pan delta application;
- fit calculations for wide, tall, empty, and oversized diagrams;
- centering at 100%;
- protection against zero or non-finite dimensions.

Component tests cover:

- collapsing to a rail and expanding without losing the draft;
- the narrow-screen compact source representation;
- the syntax-error marker while collapsed;
- zoom button increments and disabled boundary states;
- `Fit` and `100%`;
- pinch-wheel zoom anchoring;
- ordinary wheel panning;
- pointer drag and pointer-cancel cleanup;
- transform preservation across valid edits, errors, and source collapse;
- automatic refit rules on resize;
- accessible names and zoom status.

The existing autosave, last-valid-preview, conflict, persistence, and library-preview tests remain passing. A browser smoke test verifies that the editor can collapse and expand, that the toolbar changes the preview transform, and that normal editing still persists after reload.

Because synthetic browser events do not perfectly reproduce macOS trackpad hardware, final manual verification on a Mac trackpad checks:

- two-finger pan direction and speed;
- pinch focal-point stability and sensitivity;
- the 10% and 400% clamps;
- lack of accidental page zoom while pinching over the preview;
- normal page scrolling outside the preview.

## Acceptance Criteria

The feature is complete when:

1. The expanded source panel can become a thin vertical rail on desktop and a compact bar on narrow screens.
2. The preview expands into the released space without losing its transform or last valid render.
3. Mac trackpad pinch zoom and two-finger pan work inside the preview, with mouse drag as a fallback.
4. Zoom cannot leave the 10%–400% range through any interaction.
5. Zoom out, percentage, zoom in, `Fit`, and `100%` controls are accessible and functional.
6. Diagram edits and syntax errors preserve the current viewport as specified.
7. Preview navigation never mutates diagram source or persistence data.
8. Automated tests pass, followed by successful manual Mac trackpad verification.
