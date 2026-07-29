import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveDatabasePath } from './app-paths';
import { createWorkbenchServer } from './http';
import { WorkbenchStore } from './storage';

const HOST = '127.0.0.1';
const PORT = Number.parseInt(process.env.PORT ?? '4317', 10);

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(moduleDirectory, '..', '..');
const clientDirectory = path.join(projectRoot, 'dist', 'client');
const environment =
  process.env.NODE_ENV === 'production' ? 'production' : 'development';
const databasePath = resolveDatabasePath({
  environment,
  dataDirectoryOverride: process.env.MERMAID_WORKBENCH_DATA_DIR
    ? path.resolve(process.env.MERMAID_WORKBENCH_DATA_DIR)
    : undefined,
});

let store: WorkbenchStore;
try {
  store = new WorkbenchStore(databasePath);
} catch (error) {
  console.error(`Mermaid Workbench could not open its database at ${databasePath}.`);
  console.error(
    'Check that the directory is writable. Preserve the database file before attempting recovery.',
  );
  console.error(error);
  process.exitCode = 1;
  throw error;
}

const server = createWorkbenchServer({
  store,
  allowedOrigins: new Set([
    'http://127.0.0.1:5173',
    'http://localhost:5173',
    `http://${HOST}:${PORT}`,
  ]),
  clientDirectory: existsSync(clientDirectory) ? clientDirectory : undefined,
});

server.listen(PORT, HOST, () => {
  console.log(`Mermaid Workbench is running at http://${HOST}:${PORT}`);
  console.log(`Database: ${databasePath}`);
});

function shutdown(): void {
  server.close(() => {
    store.close();
    process.exitCode = 0;
  });
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
