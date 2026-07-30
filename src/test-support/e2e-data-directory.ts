import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';

const E2E_DATA_DIRECTORY_PREFIX = 'mermaid-workbench-e2e-';
const E2E_DATA_DIRECTORY_NAME =
  /^mermaid-workbench-e2e-[A-Za-z0-9]{6}$/;

export function createE2eDataDirectory(tempRoot = tmpdir()): string {
  return mkdtempSync(
    join(resolve(tempRoot), E2E_DATA_DIRECTORY_PREFIX),
  );
}

export function cleanupE2eDataDirectory(
  directory: string,
  tempRoot = tmpdir(),
): void {
  const resolvedRoot = resolve(tempRoot);
  const resolvedDirectory = resolve(directory);
  const directoryName = basename(resolvedDirectory);
  if (
    dirname(resolvedDirectory) !== resolvedRoot ||
    !E2E_DATA_DIRECTORY_NAME.test(directoryName)
  ) {
    throw new Error(
      'Refusing to remove an unrecognized E2E data directory.',
    );
  }
  rmSync(resolvedDirectory, { recursive: true, force: true });
}
