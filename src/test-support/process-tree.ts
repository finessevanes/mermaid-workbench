import {
  spawn,
  type ChildProcess,
  type SpawnOptions,
} from 'node:child_process';

export interface ProcessTree {
  child: ChildProcess;
  rootPid: number;
  trackedPids: Set<number>;
  stopTracking: () => Promise<void>;
}

const wait = (duration: number) =>
  new Promise((resolve) => setTimeout(resolve, duration));

export function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (
      error instanceof Error &&
      'code' in error &&
      error.code !== 'ESRCH'
    );
  }
}

export function spawnProcessTree(
  command: string,
  args: string[],
  options: SpawnOptions,
): ProcessTree {
  const child = spawn(command, args, {
    ...options,
    detached: process.platform !== 'win32',
  });
  if (!child.pid) {
    throw new Error(`Could not start process tree for ${command}.`);
  }
  const rootPid = child.pid;
  const trackedPids = new Set([rootPid]);
  let tracking = process.platform !== 'win32';
  let trackingError: unknown = null;
  let refresh = Promise.resolve();
  const refreshTrackedPids = () => {
    if (!tracking || !isProcessRunning(rootPid)) {
      return;
    }
    refresh = refresh
      .then(async () => {
        for (const pid of await collectPosixProcessTree(rootPid)) {
          trackedPids.add(pid);
        }
      })
      .catch((error) => {
        trackingError ??= error;
      });
  };
  const trackingInterval = setInterval(refreshTrackedPids, 50);
  trackingInterval.unref();
  refreshTrackedPids();
  return {
    child,
    rootPid,
    trackedPids,
    stopTracking: async () => {
      tracking = false;
      clearInterval(trackingInterval);
      await refresh;
      if (trackingError) {
        throw trackingError;
      }
    },
  };
}

async function collectPosixProcessTree(rootPid: number): Promise<number[]> {
  const output = await new Promise<string>((resolve, reject) => {
    const child = spawn('ps', ['-A', '-o', 'pid=', '-o', 'ppid='], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.once('error', reject);
    child.once('close', (code) => {
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error(`Could not inspect process tree: ${stderr.trim()}`));
      }
    });
  });
  const childrenByParent = new Map<number, number[]>();
  for (const line of output.split('\n')) {
    const [pidText, parentPidText] = line.trim().split(/\s+/);
    const pid = Number(pidText);
    const parentPid = Number(parentPidText);
    if (!Number.isInteger(pid) || !Number.isInteger(parentPid)) {
      continue;
    }
    const children = childrenByParent.get(parentPid) ?? [];
    children.push(pid);
    childrenByParent.set(parentPid, children);
  }
  const pids: number[] = [];
  const visit = (pid: number) => {
    pids.push(pid);
    for (const childPid of childrenByParent.get(pid) ?? []) {
      visit(childPid);
    }
  };
  visit(rootPid);
  return pids;
}

async function waitForPidsToExit(
  pids: number[],
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (pids.some(isProcessRunning)) {
    if (Date.now() >= deadline) {
      return false;
    }
    await wait(20);
  }
  return true;
}

function signalPids(pids: number[], signal: NodeJS.Signals): void {
  for (const pid of [...pids].reverse()) {
    try {
      process.kill(pid, signal);
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !('code' in error) ||
        error.code !== 'ESRCH'
      ) {
        throw error;
      }
    }
  }
}

async function terminateWindowsProcessTree(rootPid: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      'taskkill',
      ['/PID', String(rootPid), '/T', '/F'],
      {
        stdio: 'ignore',
        windowsHide: true,
      },
    );
    child.once('error', reject);
    child.once('close', (code) => {
      if (code === 0 || !isProcessRunning(rootPid)) {
        resolve();
      } else {
        reject(new Error(`taskkill exited with code ${code}.`));
      }
    });
  });
}

export async function terminateProcessTree(
  processTree: ProcessTree,
  signal: NodeJS.Signals = 'SIGTERM',
  timeoutMs = 5_000,
): Promise<void> {
  await processTree.stopTracking();
  if (process.platform === 'win32') {
    await terminateWindowsProcessTree(processTree.rootPid);
    if (!(await waitForPidsToExit([processTree.rootPid], timeoutMs))) {
      throw new Error('Timed out waiting for the process tree to exit.');
    }
    return;
  }

  if (isProcessRunning(processTree.rootPid)) {
    for (const pid of await collectPosixProcessTree(processTree.rootPid)) {
      processTree.trackedPids.add(pid);
    }
  }
  const pids = [...processTree.trackedPids];
  signalPids(pids, signal);
  if (await waitForPidsToExit(pids, timeoutMs)) {
    return;
  }

  const remainingPids = pids.filter(isProcessRunning);
  signalPids(remainingPids, 'SIGKILL');
  if (!(await waitForPidsToExit(remainingPids, timeoutMs))) {
    throw new Error('Timed out waiting for the process tree to exit.');
  }
}
