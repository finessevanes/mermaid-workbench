# Contributing to Mermaid Workbench

Thanks for helping improve Mermaid Workbench.

## Before you start

- Search existing issues before opening a new one.
- For a substantial feature or behavior change, open a proposal issue before
  writing code so the scope and user experience can be agreed on.
- Keep pull requests focused. Unrelated fixes should be separate changes.
- Never commit databases, backups, credentials, `.env` files, or user data.

## Development setup

Requirements:

- Node.js 24 or newer
- npm

Install dependencies and start the local application:

```bash
npm install
npm run dev
```

The interface is available at
[http://127.0.0.1:5173](http://127.0.0.1:5173).

## Making changes

1. Create a branch from `main`.
2. Add or update tests before implementing behavior changes.
3. Follow the existing TypeScript, React, and CSS patterns.
4. Keep the client, API, storage, and pure calculation boundaries focused.
5. Preserve the loopback-only security boundary unless a reviewed
   authentication and authorization design explicitly replaces it.
6. Update documentation when behavior or contributor workflow changes.

## Verification

Run the relevant focused tests while working, then run the complete checks
before opening a pull request:

```bash
npm test
npm run typecheck
npm run build
npm run test:e2e
```

Tests use isolated temporary data and must never read or modify the live Mermaid
Workbench library.

## Pull requests

Include:

- a clear summary of the change and why it is needed;
- the user-visible impact;
- the tests or checks you ran;
- screenshots only when the visual change benefits from them;
- any follow-up work that is intentionally out of scope.

Pull requests should be small enough to review confidently and should not
contain generated build output.
