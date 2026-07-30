import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  isProcessRunning,
  spawnProcessTree,
  terminateProcessTree,
  type ProcessTree,
} from './process-tree';

const wait = (duration: number) =>
  new Promise((resolve) => setTimeout(resolve, duration));

async function waitForFile(path: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (existsSync(path)) {
      return;
    }
    await wait(20);
  }
  throw new Error(`Timed out waiting for ${path}.`);
}

describe('process tree lifecycle', () => {
  let processTree: ProcessTree | null = null;
  let descendantPid: number | null = null;
  let testRoot: string | null = null;

  afterEach(async () => {
    await processTree?.stopTracking().catch(() => {});
    if (descendantPid && isProcessRunning(descendantPid)) {
      process.kill(descendantPid, 'SIGKILL');
    }
    if (processTree?.child.pid && isProcessRunning(processTree.child.pid)) {
      processTree.child.kill('SIGKILL');
    }
    if (testRoot) {
      rmSync(testRoot, { recursive: true, force: true });
    }
    processTree = null;
    descendantPid = null;
    testRoot = null;
  });

  it('waits for descendants to exit before cleanup begins', async () => {
    testRoot = mkdtempSync(join(tmpdir(), 'process-tree-test-'));
    const heartbeatPath = join(testRoot, 'heartbeat');
    const descendantPidPath = join(testRoot, 'descendant.pid');
    const descendantCode = `
      const fs = require('node:fs');
      const heartbeatPath = process.argv[1];
      setInterval(() => {
        fs.writeFileSync(heartbeatPath, String(Date.now()));
      }, 20);
    `;
    const parentCode = `
      const { spawn } = require('node:child_process');
      const fs = require('node:fs');
      const descendant = spawn(
        process.execPath,
        ['-e', process.argv[1], process.argv[2]],
        { stdio: 'ignore' },
      );
      fs.writeFileSync(process.argv[3], String(descendant.pid));
      setInterval(() => {}, 1000);
    `;
    processTree = spawnProcessTree(
      process.execPath,
      [
        '-e',
        parentCode,
        descendantCode,
        heartbeatPath,
        descendantPidPath,
      ],
      { stdio: 'ignore' },
    );
    await waitForFile(descendantPidPath);
    await waitForFile(heartbeatPath);
    descendantPid = Number(readFileSync(descendantPidPath, 'utf8'));

    await terminateProcessTree(processTree, 'SIGTERM');

    expect(isProcessRunning(descendantPid)).toBe(false);
    const heartbeatAfterTermination = readFileSync(heartbeatPath, 'utf8');
    await wait(80);
    expect(readFileSync(heartbeatPath, 'utf8')).toBe(
      heartbeatAfterTermination,
    );

    rmSync(testRoot, { recursive: true });
    testRoot = null;
  });

  it('terminates a tracked descendant after its parent exits abnormally', async () => {
    testRoot = mkdtempSync(join(tmpdir(), 'process-tree-test-'));
    const heartbeatPath = join(testRoot, 'heartbeat');
    const descendantPidPath = join(testRoot, 'descendant.pid');
    const descendantCode = `
      const fs = require('node:fs');
      const heartbeatPath = process.argv[1];
      setInterval(() => {
        fs.writeFileSync(heartbeatPath, String(Date.now()));
      }, 20);
    `;
    const parentCode = `
      const { spawn } = require('node:child_process');
      const fs = require('node:fs');
      const descendant = spawn(
        process.execPath,
        ['-e', process.argv[1], process.argv[2]],
        { stdio: 'ignore' },
      );
      fs.writeFileSync(process.argv[3], String(descendant.pid));
      setTimeout(() => process.exit(2), 250);
    `;
    processTree = spawnProcessTree(
      process.execPath,
      [
        '-e',
        parentCode,
        descendantCode,
        heartbeatPath,
        descendantPidPath,
      ],
      { stdio: 'ignore' },
    );
    const parentExit = once(processTree.child, 'exit');
    await waitForFile(descendantPidPath);
    await waitForFile(heartbeatPath);
    descendantPid = Number(readFileSync(descendantPidPath, 'utf8'));
    await parentExit;
    expect(isProcessRunning(descendantPid)).toBe(true);

    await terminateProcessTree(processTree);

    expect(isProcessRunning(descendantPid)).toBe(false);
    const heartbeatAfterTermination = readFileSync(heartbeatPath, 'utf8');
    await wait(80);
    expect(readFileSync(heartbeatPath, 'utf8')).toBe(
      heartbeatAfterTermination,
    );
  });
});
