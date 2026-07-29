# Mermaid Workbench Design

## Purpose

Mermaid Workbench is a reusable local application for organizing, editing, and
viewing Mermaid diagrams without depending on a hosted account or per-diagram
limits. It is independent of PLC Copilot so the same library can support future
projects.

## Product Boundary

The first version is a single-user, local-only application. It provides:

- projects that group related diagrams;
- a gallery that shows all saved diagrams;
- a Mermaid code editor with a live preview;
- automatic app-managed persistence;
- create, rename, duplicate, delete, import, and export actions; and
- clear save and Mermaid syntax-error states.

The first version does not include accounts, cloud synchronization,
collaboration, AI generation, comments, diagram history, or desktop packaging.

## Persistence

The application owns its data. Users do not manage a directory of loose Mermaid
files.

Diagram records are stored in one local database under the operating system's
standard application-data directory. The source code and development checkout
never contain the user's live diagram library. Each record contains:

- a stable identifier;
- project identifier;
- title;
- Mermaid source;
- optimistic version;
- creation timestamp; and
- last-updated timestamp.

Project records contain a stable identifier, name, creation timestamp, and
last-updated timestamp.

The application determines the data directory using the operating system rather
than a hard-coded home-directory path. A development instance uses a
development-specific database name so it cannot silently overwrite a future
packaged application's data. On macOS, the default resolves beneath
`~/Library/Application Support/Mermaid Workbench/`; equivalent conventional
application-data locations are used on other operating systems.

An individual diagram can be exported as a `.mmd` file. The complete library
can be exported as a versioned portable backup. Restoring a complete backup
replaces the existing library only after explicit confirmation and succeeds
transactionally. Imports validate their complete shape before modifying stored
data.

## User Experience

The default screen is the library gallery. It groups diagrams by project and
shows a readable preview, diagram name, and last-updated time. Empty projects
and an entirely empty library have honest calls to create or import a diagram.

Opening a diagram switches to a focused workspace:

- a compact project and diagram navigator;
- an editable Mermaid source area;
- a live rendered preview; and
- a small action area for rename, duplicate, export, and delete.

Editing updates the preview after a short debounce. Valid changes save
automatically and expose a visible `Saving`, `Saved`, or `Save failed` state. A
Mermaid syntax error does not replace the last valid preview; the editor shows
the current error beside that preserved preview. Navigating away waits for an
in-progress save or warns when a save has failed.

Deletion always names the target and requires confirmation. It removes only the
selected diagram or project. Confirmation for a non-empty project states exactly
how many diagrams will be removed.

The layout supports a typical desktop browser first and reflows into stacked
editor and preview sections at narrower widths. Keyboard focus, form labels,
error announcements, and reduced-motion preferences are preserved.

## Architecture

Mermaid Workbench runs as a local web application:

1. A small local Node server serves the interface and owns all database access.
2. A browser frontend renders the library, editor, and Mermaid preview.
3. The frontend communicates only with the local server through a narrow JSON
   API.
4. The server validates all input and persists changes transactionally.

The implementation uses TypeScript, a Vite and React browser frontend, a small
Node HTTP server, and SQLite storage. Mermaid renders in the browser from a
checked dependency. Vitest covers unit and integration behavior, and a focused
Playwright flow covers persistence through the user interface.

The frontend never receives a filesystem path and cannot choose an arbitrary
database location. The server binds to the loopback interface only. It refuses
unexpected origins and does not expose the library to the local network.

The application uses Mermaid as a local dependency rather than a remote CDN.
The initial editor uses a well-labeled monospaced text area; syntax
highlighting is not required for the first version. This keeps the dependency
surface small without limiting live editing.

## Core Components

### Library

Lists projects and diagrams, renders gallery previews, and handles empty and
loading states.

### Editor

Owns the current Mermaid source, debounced preview, dirty state, and save
feedback. It never writes directly to storage.

### Preview

Renders valid Mermaid source in an isolated container, catches parse and render
errors, and retains the last valid rendering.

### Local API

Provides project and diagram list, create, read, update, duplicate, delete,
import, and export operations. Request schemas reject unknown or malformed
values.

### Storage

Owns database initialization, migrations, transactions, and backup import. All
database queries remain behind this boundary.

## Data Flow

On launch, the frontend requests the project and diagram index. Opening a
diagram fetches its Mermaid source. Editing first updates local editor state and
requests a preview render. After the debounce window, the frontend sends the
latest source and record version to the local API.

The server commits an update only when the supplied version matches the stored
version. A stale update returns a conflict instead of silently overwriting newer
content. The frontend preserves both versions and asks the user which content
to keep.

Gallery previews are generated from saved source. They are presentation data,
not additional authoritative copies of a diagram.

## Failure Handling

- Mermaid errors preserve the last valid preview and never block source edits.
- Database initialization failures stop the application with the database
  location and a safe recovery message.
- Save failures leave the editor dirty and offer retry; they never claim the
  diagram is saved.
- Invalid or incompatible backup files are rejected before any records change.
- Backup restoration is transactional: either the complete valid import
  succeeds or the existing library remains unchanged.
- The server rejects path-like identifiers and binds only to loopback.

## Verification

Automated tests cover:

- project and diagram creation, update, duplication, and deletion;
- app-data directory selection and development/production database isolation;
- optimistic version conflicts;
- transactional backup import and invalid-backup rejection;
- Mermaid parse errors retaining the last valid preview;
- save-state transitions and retry behavior;
- non-empty project deletion confirmation; and
- loopback-only server and origin checks.

One browser-level smoke test creates a project and diagram, edits the source,
observes a live preview, reloads the application, and confirms the saved diagram
returns.

## Acceptance Criteria

The design is complete when a user can:

1. launch Mermaid Workbench locally;
2. create projects and Mermaid diagrams;
3. see all saved diagrams in a project-grouped gallery;
4. edit a diagram and see a live preview;
5. recover gracefully from a Mermaid syntax error;
6. close and reopen the application without losing saved work;
7. export one diagram or the complete library; and
8. restore a valid library backup without risking the existing library.
