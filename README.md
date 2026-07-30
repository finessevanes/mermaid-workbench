# Mermaid Workbench

[![CI](https://github.com/finessevanes/mermaid-workbench/actions/workflows/ci.yml/badge.svg)](https://github.com/finessevanes/mermaid-workbench/actions/workflows/ci.yml)

Mermaid Workbench is a local-first library and editor for organizing, writing,
and rendering Mermaid diagrams. It combines a focused source editor with a
live, zoomable preview and keeps the complete library in a local SQLite
database.

## Features

- Organize diagrams into projects.
- Edit Mermaid source with a live, last-valid preview.
- Open compatible flowcharts as draggable visual canvases whose connected
  edges reroute while nodes move.
- Persist visual node positions separately from the retained Mermaid source.
- Collapse the source editor into a slim rail for more canvas space.
- Pinch to zoom, use a two-finger gesture or mouse drag to pan, and quickly
  return to fit-to-view or 100%.
- Autosave valid diagrams with optimistic conflict protection.
- Import and export `.mmd` files.
- Export and transactionally restore complete library backups.
- Run without a CDN or external diagram-rendering service.

## Project status

The current release is a single-user, loopback-only desktop web application.
It is intentionally bound to `127.0.0.1` and is not ready to be exposed
directly to the public internet.

Email magic-link authentication and isolated personal workspaces are planned
before the hosted public release. Follow the repository for that work.

## Run locally

Requirements:

- Node.js 24 or newer
- npm

Install and start the development application:

```bash
npm install
npm run dev
```

Open [http://127.0.0.1:5173](http://127.0.0.1:5173). The Vite browser client
proxies its API calls to the local server at `127.0.0.1:4317`.

Create and run a production build:

```bash
npm run build
npm run start
```

The production server serves both the interface and API from
[http://127.0.0.1:4317](http://127.0.0.1:4317).

## Library storage

Mermaid Workbench chooses the operating system's conventional application-data
directory. The browser never receives this path and cannot select another
database file.

- macOS development:
  `~/Library/Application Support/Mermaid Workbench/mermaid-workbench-development.sqlite3`
- macOS production:
  `~/Library/Application Support/Mermaid Workbench/mermaid-workbench.sqlite3`
- Linux: `$XDG_DATA_HOME/Mermaid Workbench/`, falling back to
  `~/.local/share/Mermaid Workbench/`
- Windows: `%APPDATA%\Mermaid Workbench\`

Development and production use different filenames. Tests set
`MERMAID_WORKBENCH_DATA_DIR` to an isolated, ignored directory so they cannot
modify the live library.

The database uses foreign keys, transactional backup replacement, and
optimistic record versions. If two writes race, the editor presents the saved
and submitted versions instead of overwriting either silently.

## Import and export

- `Import .mmd` creates a diagram in the selected project from a plain Mermaid
  source file.
- `Export .mmd` downloads one diagram's source.
- `Export backup` downloads the complete library as a versioned JSON backup.
- `Restore backup` validates the entire file and requires explicit replacement
  confirmation. The restore runs in one transaction; a rejected or failed
  restore leaves the current library unchanged.

Keep exported backups somewhere outside the source checkout.

## Preview navigation

- Pinch on a Mac trackpad to zoom around the gesture position.
- Slide with two fingers or drag with the primary mouse button to pan.
- Use the preview toolbar to zoom in, zoom out, fit the complete diagram, or
  return to 100%.
- Zoom is clamped between 10% and 400%.

The browser does not expose a dependable exact three-finger trackpad gesture,
so Mermaid Workbench uses standard two-finger wheel movement for panning.

## Interactive flowcharts

Compatible `flowchart` and `graph` diagrams open in an interactive canvas.
Drag nodes to arrange the diagram; connected edges reroute during the drag,
and the resulting node positions persist independently from the Mermaid
source. Use `Reset layout` to replace manual positions with a fresh automatic
layout.

Mermaid source remains the import and export format. For an interactive
flowchart, choose `Edit import`, stage the source change, and then choose
`Apply import` to update the canvas explicitly. Diagrams that are not
compatible with the interactive flowchart importer, including sequence
diagrams, continue to use the editable source panel and static Mermaid
preview with an explanation.

V1 does not visually add or delete nodes, and it does not visually add,
delete, or reconnect edges. Make those topology changes in Mermaid source and
apply them through the import flow.

## Verification commands

```bash
npm test
npm run typecheck
npm run build
npm run test:e2e
```

`npm test` runs unit and HTTP integration coverage. `npm run test:e2e` starts an
isolated development instance and uses Playwright to drag and persist a
flowchart layout, reset it, reload it, and verify the static fallback for an
unsupported diagram.

## Local security boundary

The server binds only to `127.0.0.1`. Requests with an unexpected browser
`Origin` are rejected, JSON bodies are size-limited and strictly validated,
record identifiers must be UUIDs, and filesystem paths are never accepted by
the API.

Do not change the bind address to `0.0.0.0` and expose the current server
without adding authentication and per-user authorization first.

## Contributing

Contributions are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) for the
development workflow and [SECURITY.md](SECURITY.md) for vulnerability
reporting. Community participation is governed by
[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

## License

No open-source license has been granted. The source is publicly available for
inspection and contribution, but reuse and redistribution rights are reserved.
