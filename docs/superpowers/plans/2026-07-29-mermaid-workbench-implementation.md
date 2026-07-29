# Mermaid Workbench Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local-only browser application that persists project-grouped Mermaid diagrams, renders them live, and safely imports or exports individual diagrams and complete backups.

**Architecture:** A Node HTTP server bound to `127.0.0.1` owns a SQLite database and exposes a narrow JSON API. A Vite/React client consumes only that API, renders Mermaid from a checked local dependency, and handles autosave, conflict, and syntax-error states without receiving filesystem paths.

**Tech Stack:** Node 25+, TypeScript, React 19, Vite 7, Mermaid 11, Zod 4, Node `node:sqlite`, Vitest 3, Testing Library, and Playwright.

## Global Constraints

- The first release is single-user and local-only.
- The server must bind to loopback and reject unexpected `Origin` headers.
- The development database name must differ from the production database name.
- The frontend must never receive or choose a database path.
- Record writes use optimistic versions; stale writes return a conflict.
- Mermaid syntax errors preserve the last valid rendered preview.
- Complete backup restoration validates before modifying data and runs transactionally.
- Destructive actions name their target and require confirmation.
- The UI must provide labels, keyboard focus, live status announcements, responsive layout, and reduced-motion support.

---

### Task 1: Workspace and Test Harness

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vite.config.ts`
- Create: `vitest.config.ts`
- Create: `playwright.config.ts`
- Create: `index.html`
- Create: `src/client/test/setup.ts`
- Create: `.gitignore`

**Interfaces:**
- Consumes: Node 25 and npm.
- Produces: `npm run dev`, `npm run build`, `npm test`, `npm run test:e2e`, and the `@client/*`, `@server/*`, `@shared/*` TypeScript aliases.

- [ ] **Step 1: Write the failing harness test**

Create `src/shared/smoke.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { APP_NAME } from './constants';

describe('workspace', () => {
  it('identifies the application', () => {
    expect(APP_NAME).toBe('Mermaid Workbench');
  });
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `npm test -- src/shared/smoke.test.ts`

Expected: FAIL because neither the workspace configuration nor `src/shared/constants.ts` exists.

- [ ] **Step 3: Add the minimal workspace configuration and constant**

Create `src/shared/constants.ts`:

```ts
export const APP_NAME = 'Mermaid Workbench';
export const API_PREFIX = '/api';
export const DEV_DATABASE_NAME = 'mermaid-workbench-development.sqlite3';
export const PROD_DATABASE_NAME = 'mermaid-workbench.sqlite3';
```

Configure npm scripts so `dev` runs Vite and `tsx --watch src/server/main.ts`, `build` runs both TypeScript checks and the Vite build, and `test` runs Vitest. Configure Vite to listen on `127.0.0.1:5173` and proxy `/api` to `127.0.0.1:4317`.

- [ ] **Step 4: Install dependencies and verify GREEN**

Run: `npm install`

Run: `npm test -- src/shared/smoke.test.ts`

Expected: 1 passing test.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json tsconfig.json vite.config.ts vitest.config.ts playwright.config.ts index.html .gitignore src/shared src/client/test
git commit -m "build: scaffold Mermaid Workbench"
```

### Task 2: App Paths, Schemas, and SQLite Storage

**Files:**
- Create: `src/shared/types.ts`
- Create: `src/server/app-paths.ts`
- Create: `src/server/schemas.ts`
- Create: `src/server/storage.ts`
- Create: `src/server/app-paths.test.ts`
- Create: `src/server/storage.test.ts`

**Interfaces:**
- Consumes: `DEV_DATABASE_NAME`, `PROD_DATABASE_NAME`, Zod, and `DatabaseSync`.
- Produces: `resolveDatabasePath(options)`, `projectInputSchema`, `diagramInputSchema`, `backupSchema`, and `WorkbenchStore` methods for every persistence operation.

- [ ] **Step 1: Write failing path and CRUD tests**

Tests must assert:

```ts
expect(resolveDatabasePath({ platform: 'darwin', homeDirectory: '/Users/ada', environment: 'development' }))
  .toBe('/Users/ada/Library/Application Support/Mermaid Workbench/mermaid-workbench-development.sqlite3');
expect(resolveDatabasePath({ platform: 'darwin', homeDirectory: '/Users/ada', environment: 'production' }))
  .toBe('/Users/ada/Library/Application Support/Mermaid Workbench/mermaid-workbench.sqlite3');
```

Create a temporary SQLite file and assert that `createProject`, `createDiagram`, `updateDiagram`, `duplicateDiagram`, `deleteDiagram`, and `deleteProject` return the exact stored records. Assert that an update with the old version throws `VersionConflictError` with both `current` and `submitted` records.

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `npm test -- src/server/app-paths.test.ts src/server/storage.test.ts`

Expected: FAIL because the modules do not exist.

- [ ] **Step 3: Implement paths, migrations, records, and optimistic writes**

Use these public shapes:

```ts
export interface ProjectRecord {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface DiagramRecord {
  id: string;
  projectId: string;
  title: string;
  source: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export class WorkbenchStore {
  constructor(databasePath: string);
  close(): void;
  listLibrary(): { projects: ProjectRecord[]; diagrams: DiagramRecord[] };
  createProject(input: { name: string }): ProjectRecord;
  renameProject(id: string, input: { name: string }): ProjectRecord;
  deleteProject(id: string): { deletedProjectId: string; deletedDiagramCount: number };
  createDiagram(input: { projectId: string; title: string; source: string }): DiagramRecord;
  getDiagram(id: string): DiagramRecord;
  updateDiagram(id: string, input: { title?: string; source?: string; version: number; force?: boolean }): DiagramRecord;
  duplicateDiagram(id: string): DiagramRecord;
  deleteDiagram(id: string): { deletedDiagramId: string };
  exportBackup(): LibraryBackupV1;
  restoreBackup(input: LibraryBackupV1): void;
}
```

Create `projects` and `diagrams` tables with foreign keys enabled and `ON DELETE CASCADE`. Use `crypto.randomUUID()`, ISO timestamps, prepared statements, and `BEGIN IMMEDIATE` / `COMMIT` / `ROLLBACK` for backup restore.

- [ ] **Step 4: Verify CRUD GREEN**

Run: `npm test -- src/server/app-paths.test.ts src/server/storage.test.ts`

Expected: path selection, CRUD, and conflict tests pass.

- [ ] **Step 5: Add failing backup transaction tests**

Assert the backup shape is:

```ts
{
  format: 'mermaid-workbench-backup',
  version: 1,
  exportedAt: expect.any(String),
  projects: expect.any(Array),
  diagrams: expect.any(Array)
}
```

Try restoring a backup whose diagram references a missing project and assert the original library remains byte-for-byte equal to its pre-import state.

- [ ] **Step 6: Implement strict backup validation and transactional restore**

Define Zod objects with `.strict()`, validate UUIDs, timestamps, positive integer record versions, unique IDs, and all project references before the transaction begins. Replace all records only after complete validation.

- [ ] **Step 7: Verify backup GREEN and commit**

Run: `npm test -- src/server/app-paths.test.ts src/server/storage.test.ts`

Expected: all storage tests pass.

```bash
git add src/shared/types.ts src/server
git commit -m "feat: add transactional SQLite storage"
```

### Task 3: Loopback HTTP API and Security

**Files:**
- Create: `src/server/http.ts`
- Create: `src/server/main.ts`
- Create: `src/server/http.test.ts`

**Interfaces:**
- Consumes: `WorkbenchStore` and strict Zod schemas.
- Produces: `createWorkbenchServer({ store, allowedOrigins, clientDirectory? })` and JSON routes beneath `/api`.

- [ ] **Step 1: Write failing API integration tests**

Start the server on `127.0.0.1` with port `0`. Assert:

```ts
expect(await request('GET', '/api/library')).toMatchObject({ status: 200 });
expect(await request('POST', '/api/projects', { name: 'Launch maps' })).toMatchObject({ status: 201 });
expect(await request('POST', '/api/projects', { name: 'Launch maps', extra: true })).toMatchObject({ status: 400 });
expect(await request('GET', '/api/library', undefined, { Origin: 'https://attacker.example' })).toMatchObject({ status: 403 });
expect(server.address()).toMatchObject({ address: '127.0.0.1' });
```

Cover projects, diagrams, duplicate, conflict, `.mmd` export, library backup, restore confirmation, malformed IDs, missing records, and unknown routes.

- [ ] **Step 2: Run the API tests and verify RED**

Run: `npm test -- src/server/http.test.ts`

Expected: FAIL because the HTTP modules do not exist.

- [ ] **Step 3: Implement the API**

Provide routes:

```text
GET    /api/library
POST   /api/projects
PATCH  /api/projects/:id
DELETE /api/projects/:id
POST   /api/diagrams
GET    /api/diagrams/:id
PUT    /api/diagrams/:id
DELETE /api/diagrams/:id
POST   /api/diagrams/:id/duplicate
GET    /api/diagrams/:id/export
GET    /api/backup
POST   /api/backup/restore
GET    /api/health
```

Cap JSON request bodies at 10 MiB. Return `{ error: { code, message, details? } }` for errors. Return status 409 for optimistic conflicts and backup restore without `{ confirmReplace: true }`. Sanitize export filenames while keeping a `.mmd` suffix.

- [ ] **Step 4: Verify GREEN and commit**

Run: `npm test -- src/server/http.test.ts`

Expected: all API and security tests pass.

```bash
git add src/server/http.ts src/server/main.ts src/server/http.test.ts
git commit -m "feat: expose secure local API"
```

### Task 4: Client API, Save State, and Preview State

**Files:**
- Create: `src/client/api.ts`
- Create: `src/client/save-state.ts`
- Create: `src/client/use-mermaid-preview.ts`
- Create: `src/client/save-state.test.ts`
- Create: `src/client/use-mermaid-preview.test.tsx`

**Interfaces:**
- Consumes: shared record types and browser `fetch`.
- Produces: typed `api` methods, `saveStateReducer`, and `useMermaidPreview(source, render?)`.

- [ ] **Step 1: Write failing state tests**

Verify the reducer transitions:

```ts
expect(saveStateReducer({ status: 'saved' }, { type: 'EDITED' })).toEqual({ status: 'dirty' });
expect(saveStateReducer({ status: 'dirty' }, { type: 'SAVE_STARTED' })).toEqual({ status: 'saving' });
expect(saveStateReducer({ status: 'saving' }, { type: 'SAVE_SUCCEEDED' })).toEqual({ status: 'saved' });
expect(saveStateReducer({ status: 'saving' }, { type: 'SAVE_FAILED', message: 'Offline' }))
  .toEqual({ status: 'failed', message: 'Offline' });
```

Render the preview hook with an injected renderer that succeeds once and then throws. Assert the second state reports the error while retaining the first successful SVG.

- [ ] **Step 2: Run the client state tests and verify RED**

Run: `npm test -- src/client/save-state.test.ts src/client/use-mermaid-preview.test.tsx`

Expected: FAIL because the modules do not exist.

- [ ] **Step 3: Implement client state modules**

The preview result must be:

```ts
interface MermaidPreviewState {
  svg: string;
  error: string | null;
  rendering: boolean;
}
```

Debounce parsing/rendering by 220 ms, call local `mermaid.render` with a unique ID, ignore stale async results, and retain the previous non-empty `svg` when rendering throws.

- [ ] **Step 4: Verify GREEN and commit**

Run: `npm test -- src/client/save-state.test.ts src/client/use-mermaid-preview.test.tsx`

Expected: all state and preview tests pass.

```bash
git add src/client/api.ts src/client/save-state.ts src/client/use-mermaid-preview.ts src/client/*.test.*
git commit -m "feat: add typed client state"
```

### Task 5: React Library and Editor Experience

**Files:**
- Create: `src/client/main.tsx`
- Create: `src/client/App.tsx`
- Create: `src/client/components/LibraryView.tsx`
- Create: `src/client/components/EditorView.tsx`
- Create: `src/client/components/MermaidPreview.tsx`
- Create: `src/client/components/Dialog.tsx`
- Create: `src/client/confirmations.ts`
- Create: `src/client/confirmations.test.ts`
- Create: `src/client/App.test.tsx`

**Interfaces:**
- Consumes: typed `api`, save-state reducer, and Mermaid preview hook.
- Produces: the complete project gallery, diagram workspace, dialogs, import/export actions, and responsive accessible UI structure.

- [ ] **Step 1: Write failing UI tests**

Assert the non-empty project copy exactly names the deletion impact:

```ts
expect(projectDeletionMessage('Launch maps', 3))
  .toBe('Delete “Launch maps” and its 3 diagrams? This cannot be undone.');
```

With a real in-memory fetch adapter, assert the App:

- shows “Create your first project” for an empty library;
- creates a named project and diagram;
- opens the editor and labels the textarea “Mermaid source”;
- reports `Saving…`, then `Saved`;
- preserves the last preview and reports a syntax error;
- exposes retry after a failed save;
- presents both versions after a 409 conflict.

- [ ] **Step 2: Run the UI tests and verify RED**

Run: `npm test -- src/client/confirmations.test.ts src/client/App.test.tsx`

Expected: FAIL because the components do not exist.

- [ ] **Step 3: Implement the library**

Group diagrams under project headings. Each gallery card renders a compact Mermaid preview, title, and relative update time. Empty projects offer “New diagram”; an empty library offers “Create your first project” and “Restore backup”.

- [ ] **Step 4: Run tests and confirm the library behaviors pass**

Run: `npm test -- src/client/App.test.tsx -t "library"`

Expected: library tests pass.

- [ ] **Step 5: Implement the editor**

Use a controlled textarea, update the preview immediately after its debounce, and autosave valid source 650 ms after the last edit. Disable autosave while the preview is invalid. Flush an active save before returning to the library. On failure, keep the source dirty and provide “Retry save”. On conflict, show “Keep my version” and “Use saved version”.

- [ ] **Step 6: Implement create, rename, duplicate, delete, import, and export**

Use `<dialog>` with labelled forms. Import an `.mmd` as a new diagram in the selected project. Download an individual diagram from its export endpoint and a complete JSON backup from `/api/backup`. Require a second explicit confirmation before sending `{ confirmReplace: true, backup }` to restore.

- [ ] **Step 7: Verify GREEN and commit**

Run: `npm test -- src/client`

Expected: all client tests pass.

```bash
git add src/client
git commit -m "feat: build Mermaid library and editor"
```

### Task 6: Visual System and Responsive Accessibility

**Files:**
- Create: `src/client/styles.css`
- Modify: `src/client/main.tsx`
- Modify: `src/client/components/LibraryView.tsx`
- Modify: `src/client/components/EditorView.tsx`

**Interfaces:**
- Consumes: semantic markup from Task 5.
- Produces: a desktop-first visual system that stacks editor and preview below 900 px and respects `prefers-reduced-motion`.

- [ ] **Step 1: Add a failing structural accessibility assertion**

In `App.test.tsx`, assert a loaded editor contains exactly one `<main>`, a visible `<h1>`, a labelled source textarea, a status region with `role="status"`, and an error region with `role="alert"`.

- [ ] **Step 2: Run the assertion and verify RED**

Run: `npm test -- src/client/App.test.tsx -t "accessible workspace"`

Expected: FAIL until the landmarks and live regions are complete.

- [ ] **Step 3: Implement the visual system**

Use CSS custom properties for ink, paper, muted, accent, danger, borders, shadows, and spacing. Use a warm neutral canvas, dark navy navigation rail, cobalt primary action, and amber save/error accents. Provide visible `:focus-visible` outlines. Apply `grid-template-columns: minmax(320px, 0.9fr) minmax(420px, 1.1fr)` to the workspace and one column below 900 px.

- [ ] **Step 4: Verify GREEN and commit**

Run: `npm test -- src/client/App.test.tsx`

Expected: accessibility assertions and existing UI tests pass.

```bash
git add src/client
git commit -m "style: polish responsive workbench"
```

### Task 7: Browser Persistence Flow and Release Verification

**Files:**
- Create: `e2e/persistence.spec.ts`
- Create: `README.md`
- Modify: `package.json`

**Interfaces:**
- Consumes: development server, client application, and a temporary `MERMAID_WORKBENCH_DATA_DIR`.
- Produces: one Playwright persistence flow and complete run instructions.

- [ ] **Step 1: Write the failing browser flow**

The Playwright test must:

```ts
await page.getByRole('button', { name: 'Create your first project' }).click();
await page.getByLabel('Project name').fill('Launch maps');
await page.getByRole('button', { name: 'Create project' }).click();
await page.getByRole('button', { name: 'New diagram' }).click();
await page.getByLabel('Diagram title').fill('Release path');
await page.getByRole('button', { name: 'Create diagram' }).click();
await page.getByLabel('Mermaid source').fill('flowchart LR\\n  Idea --> Build --> Ship');
await expect(page.getByRole('status')).toContainText('Saved');
await expect(page.locator('[data-testid="mermaid-preview"] svg')).toBeVisible();
await page.reload();
await expect(page.getByDisplayValue('flowchart LR\\n  Idea --> Build --> Ship')).toBeVisible();
```

- [ ] **Step 2: Run the browser flow and verify RED**

Run: `npm run test:e2e`

Expected: FAIL until the complete app is wired and the browser is available.

- [ ] **Step 3: Complete production wiring and documentation**

Make `src/server/main.ts` serve `dist/client` when present and print:

```text
Mermaid Workbench is running at http://127.0.0.1:4317
Database: <resolved development or production path>
```

Document `npm install`, `npm run dev`, `npm test`, `npm run build`, `npm run start`, backup behavior, and the database path policy.

- [ ] **Step 4: Run full verification**

Run: `npm test`

Expected: all Vitest tests pass with no unhandled errors.

Run: `npm run build`

Expected: TypeScript and Vite build complete without warnings or errors.

Run: `npm run test:e2e`

Expected: the persistence smoke test passes.

- [ ] **Step 5: Commit**

```bash
git add e2e README.md package.json package-lock.json src/server/main.ts
git commit -m "test: verify local persistence flow"
```

### Task 8: Launch and Manual Acceptance Check

**Files:**
- No source changes expected.

**Interfaces:**
- Consumes: the verified development scripts.
- Produces: a running Mermaid Workbench URL on loopback.

- [ ] **Step 1: Start the application**

Run: `npm run dev`

Expected: the server reports `http://127.0.0.1:4317` and Vite reports `http://127.0.0.1:5173`.

- [ ] **Step 2: Check health and origin behavior**

Run: `curl -fsS http://127.0.0.1:4317/api/health`

Expected: `{"status":"ok"}`.

Run: `curl -sS -o /dev/null -w '%{http_code}' -H 'Origin: https://attacker.example' http://127.0.0.1:4317/api/library`

Expected: `403`.

- [ ] **Step 3: Open the application**

Open `http://127.0.0.1:5173` in the in-app browser and confirm the empty-library experience, editor rendering, save status, syntax-error preservation, reload persistence, and narrow viewport layout.

- [ ] **Step 4: Report the worktree, branch, verification evidence, database policy, and live URL**

The handoff must state that the design checkout remains untouched and link the plan and README from the implementation worktree.
