import { createReadStream, existsSync, statSync } from 'node:fs';
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import path from 'node:path';
import { z, ZodError } from 'zod';
import type { ApiErrorBody } from '@shared/types';
import {
  diagramInputSchema,
  diagramUpdateSchema,
  projectInputSchema,
} from './schemas';
import {
  InvalidBackupError,
  RecordNotFoundError,
  VersionConflictError,
  type WorkbenchStore,
} from './storage';

const MAX_JSON_BODY_BYTES = 10 * 1024 * 1024;
const identifierSchema = z.string().uuid();

class InvalidJsonError extends Error {
  constructor() {
    super('The request body must be valid JSON.');
    this.name = 'InvalidJsonError';
  }
}

class RequestTooLargeError extends Error {
  constructor() {
    super('The request body exceeds the 10 MiB limit.');
    this.name = 'RequestTooLargeError';
  }
}

interface WorkbenchServerOptions {
  store: WorkbenchStore;
  allowedOrigins: ReadonlySet<string>;
  clientDirectory?: string;
}

function sendJson(
  response: ServerResponse,
  status: number,
  body: unknown,
): void {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  response.end(JSON.stringify(body));
}

function sendError(
  response: ServerResponse,
  status: number,
  code: string,
  message: string,
  details?: unknown,
): void {
  const body: ApiErrorBody = {
    error: {
      code,
      message,
      ...(details === undefined ? {} : { details }),
    },
  };
  sendJson(response, status, body);
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.byteLength;
    if (size > MAX_JSON_BODY_BYTES) {
      throw new RequestTooLargeError();
    }
    chunks.push(buffer);
  }
  if (chunks.length === 0) {
    throw new InvalidJsonError();
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch {
    throw new InvalidJsonError();
  }
}

function parseIdentifier(segment: string): string {
  let decoded: string;
  try {
    decoded = decodeURIComponent(segment);
  } catch {
    throw new ZodError([]);
  }
  const result = identifierSchema.safeParse(decoded);
  if (!result.success) {
    const error = new Error('The record identifier is invalid.');
    error.name = 'InvalidIdentifierError';
    throw error;
  }
  return result.data;
}

function safeExportFilename(title: string): string {
  const withoutPaths = title.replaceAll('/', '').replaceAll('\\', '');
  const normalized = withoutPaths
    .replace(/^\.+/, '')
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${normalized || 'diagram'}.mmd`;
}

function mimeType(filePath: string): string {
  switch (path.extname(filePath)) {
    case '.html':
      return 'text/html; charset=utf-8';
    case '.js':
      return 'text/javascript; charset=utf-8';
    case '.css':
      return 'text/css; charset=utf-8';
    case '.svg':
      return 'image/svg+xml';
    case '.json':
      return 'application/json; charset=utf-8';
    default:
      return 'application/octet-stream';
  }
}

function serveClientFile(
  requestPath: string,
  clientDirectory: string,
  response: ServerResponse,
): boolean {
  if (!existsSync(clientDirectory)) {
    return false;
  }
  const normalizedPath =
    requestPath === '/' ? 'index.html' : requestPath.replace(/^\/+/, '');
  const candidate = path.resolve(clientDirectory, normalizedPath);
  const root = path.resolve(clientDirectory);
  const safeCandidate =
    candidate === root || candidate.startsWith(`${root}${path.sep}`);
  const filePath =
    safeCandidate && existsSync(candidate) && statSync(candidate).isFile()
      ? candidate
      : path.join(root, 'index.html');
  if (!existsSync(filePath)) {
    return false;
  }
  response.writeHead(200, {
    'content-type': mimeType(filePath),
    'x-content-type-options': 'nosniff',
  });
  createReadStream(filePath).pipe(response);
  return true;
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  options: WorkbenchServerOptions,
): Promise<void> {
  const origin = request.headers.origin;
  if (origin && !options.allowedOrigins.has(origin)) {
    sendError(
      response,
      403,
      'ORIGIN_FORBIDDEN',
      'This local API does not accept requests from that origin.',
    );
    return;
  }

  const url = new URL(request.url ?? '/', 'http://127.0.0.1');
  const route = url.pathname;
  const method = request.method ?? 'GET';

  if (method === 'GET' && route === '/api/health') {
    sendJson(response, 200, { status: 'ok' });
    return;
  }

  if (method === 'GET' && route === '/api/library') {
    sendJson(response, 200, options.store.listLibrary());
    return;
  }

  if (method === 'POST' && route === '/api/projects') {
    const input = projectInputSchema.parse(await readJson(request));
    sendJson(response, 201, options.store.createProject(input));
    return;
  }

  const projectMatch = route.match(/^\/api\/projects\/([^/]+)$/);
  if (projectMatch) {
    const id = parseIdentifier(projectMatch[1]);
    if (method === 'PATCH') {
      const input = projectInputSchema.parse(await readJson(request));
      sendJson(response, 200, options.store.renameProject(id, input));
      return;
    }
    if (method === 'DELETE') {
      sendJson(response, 200, options.store.deleteProject(id));
      return;
    }
  }

  if (method === 'POST' && route === '/api/diagrams') {
    const input = diagramInputSchema.parse(await readJson(request));
    sendJson(response, 201, options.store.createDiagram(input));
    return;
  }

  const duplicateMatch = route.match(
    /^\/api\/diagrams\/([^/]+)\/duplicate$/,
  );
  if (method === 'POST' && duplicateMatch) {
    const id = parseIdentifier(duplicateMatch[1]);
    sendJson(response, 201, options.store.duplicateDiagram(id));
    return;
  }

  const exportMatch = route.match(/^\/api\/diagrams\/([^/]+)\/export$/);
  if (method === 'GET' && exportMatch) {
    const id = parseIdentifier(exportMatch[1]);
    const diagram = options.store.getDiagram(id);
    response.writeHead(200, {
      'content-type': 'text/plain; charset=utf-8',
      'content-disposition': `attachment; filename="${safeExportFilename(diagram.title)}"`,
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    });
    response.end(diagram.source);
    return;
  }

  const diagramMatch = route.match(/^\/api\/diagrams\/([^/]+)$/);
  if (diagramMatch) {
    const id = parseIdentifier(diagramMatch[1]);
    if (method === 'GET') {
      sendJson(response, 200, options.store.getDiagram(id));
      return;
    }
    if (method === 'PUT') {
      const input = diagramUpdateSchema.parse(await readJson(request));
      sendJson(response, 200, options.store.updateDiagram(id, input));
      return;
    }
    if (method === 'DELETE') {
      sendJson(response, 200, options.store.deleteDiagram(id));
      return;
    }
  }

  if (method === 'GET' && route === '/api/backup') {
    const backup = options.store.exportBackup();
    response.writeHead(200, {
      'content-type': 'application/json; charset=utf-8',
      'content-disposition':
        'attachment; filename="mermaid-workbench-backup.json"',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    });
    response.end(JSON.stringify(backup, null, 2));
    return;
  }

  if (method === 'POST' && route === '/api/backup/restore') {
    const input = await readJson(request);
    if (
      typeof input !== 'object' ||
      input === null ||
      !('confirmReplace' in input) ||
      input.confirmReplace !== true
    ) {
      sendError(
        response,
        409,
        'RESTORE_CONFIRMATION_REQUIRED',
        'Confirm that restoring this backup will replace the current library.',
      );
      return;
    }
    if (!('backup' in input)) {
      throw new InvalidJsonError();
    }
    options.store.restoreBackup(input.backup);
    sendJson(response, 200, { restored: true });
    return;
  }

  if (
    !route.startsWith('/api/') &&
    method === 'GET' &&
    options.clientDirectory &&
    serveClientFile(route, options.clientDirectory, response)
  ) {
    return;
  }

  sendError(response, 404, 'NOT_FOUND', 'The requested resource was not found.');
}

function handleFailure(error: unknown, response: ServerResponse): void {
  if (response.headersSent) {
    response.end();
    return;
  }
  if (error instanceof ZodError) {
    sendError(
      response,
      400,
      'INVALID_REQUEST',
      'The request did not match the expected shape.',
      error.flatten(),
    );
    return;
  }
  if (error instanceof InvalidJsonError) {
    sendError(response, 400, 'INVALID_JSON', error.message);
    return;
  }
  if (error instanceof RequestTooLargeError) {
    sendError(response, 413, 'REQUEST_TOO_LARGE', error.message);
    return;
  }
  if (error instanceof RecordNotFoundError) {
    sendError(response, 404, 'RECORD_NOT_FOUND', error.message);
    return;
  }
  if (error instanceof VersionConflictError) {
    sendError(response, 409, 'VERSION_CONFLICT', error.message, {
      current: error.current,
      submitted: error.submitted,
    });
    return;
  }
  if (error instanceof InvalidBackupError) {
    sendError(
      response,
      400,
      'INVALID_BACKUP',
      error.message,
      error.details,
    );
    return;
  }
  if (error instanceof Error && error.name === 'InvalidIdentifierError') {
    sendError(response, 400, 'INVALID_IDENTIFIER', error.message);
    return;
  }
  console.error('Unhandled local API error:', error);
  sendError(
    response,
    500,
    'INTERNAL_ERROR',
    'The local server could not complete the request.',
  );
}

export function createWorkbenchServer(
  options: WorkbenchServerOptions,
): Server {
  return createServer((request, response) => {
    void handleRequest(request, response, options).catch((error: unknown) => {
      handleFailure(error, response);
    });
  });
}
