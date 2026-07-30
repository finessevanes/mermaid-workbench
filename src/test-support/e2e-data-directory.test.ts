import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  cleanupE2eDataDirectory,
  createE2eDataDirectory,
} from './e2e-data-directory';

describe('E2E data directory lifecycle', () => {
  const testRoots: string[] = [];

  afterEach(() => {
    for (const testRoot of testRoots.splice(0)) {
      rmSync(testRoot, { recursive: true, force: true });
    }
  });

  function createTestRoot() {
    const testRoot = mkdtempSync(
      join(tmpdir(), 'mermaid-workbench-e2e-lifecycle-test-'),
    );
    testRoots.push(testRoot);
    return testRoot;
  }

  it('creates unique directories and removes only the requested directory', () => {
    const testRoot = createTestRoot();
    const first = createE2eDataDirectory(testRoot);
    const second = createE2eDataDirectory(testRoot);
    writeFileSync(join(first, 'database.sqlite3'), 'first');
    writeFileSync(join(second, 'database.sqlite3'), 'second');

    expect(first).not.toBe(second);

    cleanupE2eDataDirectory(first, testRoot);

    expect(existsSync(first)).toBe(false);
    expect(existsSync(second)).toBe(true);
  });

  it('rejects the temp root and unrelated child directories before deletion', () => {
    const testRoot = createTestRoot();
    const unrelated = join(testRoot, 'unrelated');
    const prefixLookalike = join(
      testRoot,
      'mermaid-workbench-e2e-not-minted',
    );
    mkdirSync(unrelated);
    mkdirSync(prefixLookalike);

    expect(() => cleanupE2eDataDirectory(testRoot, testRoot)).toThrow(
      'Refusing to remove an unrecognized E2E data directory.',
    );
    expect(() => cleanupE2eDataDirectory(unrelated, testRoot)).toThrow(
      'Refusing to remove an unrecognized E2E data directory.',
    );
    expect(() => cleanupE2eDataDirectory(prefixLookalike, testRoot)).toThrow(
      'Refusing to remove an unrecognized E2E data directory.',
    );
    expect(existsSync(testRoot)).toBe(true);
    expect(existsSync(unrelated)).toBe(true);
    expect(existsSync(prefixLookalike)).toBe(true);
  });
});
