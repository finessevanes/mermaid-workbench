# Mermaid Workbench

Mermaid Workbench is a private, local library for organizing, editing, and
rendering Mermaid diagrams. It runs as a loopback-only web application, stores
its library in SQLite, and loads Mermaid from the installed application
dependency rather than a CDN.

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

## Verification commands

```bash
npm test
npm run typecheck
npm run build
npm run test:e2e
```

`npm test` runs unit and HTTP integration coverage. `npm run test:e2e` starts an
isolated development instance and uses Playwright to create, render, save,
reload, and reopen a diagram.

## Local security boundary

The server binds only to `127.0.0.1`. Requests with an unexpected browser
`Origin` are rejected, JSON bodies are size-limited and strictly validated,
record identifiers must be UUIDs, and filesystem paths are never accepted by
the API.
