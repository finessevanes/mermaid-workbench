import { createRequire } from 'node:module';
import {
  cleanupE2eDataDirectory,
  createE2eDataDirectory,
} from '../src/test-support/e2e-data-directory';
import {
  spawnProcessTree,
  terminateProcessTree,
  type ProcessTree,
} from '../src/test-support/process-tree';

interface ProcessExit {
  code: number | null;
  signal: NodeJS.Signals | null;
}

class ShutdownRequested extends Error {
  constructor(readonly signal: NodeJS.Signals) {
    super(`Shutdown requested by ${signal}.`);
  }
}

const wait = (duration: number) =>
  new Promise((resolve) => setTimeout(resolve, duration));

function waitForProcessExit(processTree: ProcessTree): Promise<ProcessExit> {
  return new Promise((resolve, reject) => {
    processTree.child.once('error', reject);
    processTree.child.once('exit', (code, signal) => {
      resolve({ code, signal });
    });
  });
}

async function waitForServer(
  serverExit: Promise<ProcessExit>,
): Promise<void> {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch('http://127.0.0.1:5173');
      if (response.ok) {
        return;
      }
    } catch {
      // The development server is still starting.
    }
    await Promise.race([
      wait(100),
      serverExit.then(({ code, signal }) => {
        throw new Error(
          `E2E server exited before it was ready: code=${code} signal=${signal}.`,
        );
      }),
    ]);
  }
  throw new Error('Timed out waiting for the E2E server.');
}

function signalExitCode(signal: NodeJS.Signals): number {
  return signal === 'SIGINT' ? 130 : 143;
}

const e2eDataDirectory = createE2eDataDirectory();
const playwrightCli = createRequire(import.meta.url).resolve(
  '@playwright/test/cli',
);
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
let serverTree: ProcessTree | null = null;
let playwrightTree: ProcessTree | null = null;
let exitCode = 1;
let requestShutdown: (signal: NodeJS.Signals) => void = () => {};
const shutdown = new Promise<NodeJS.Signals>((resolve) => {
  requestShutdown = resolve;
});
const handleSignal = (signal: NodeJS.Signals) => {
  requestShutdown(signal);
};
process.once('SIGINT', handleSignal);
process.once('SIGTERM', handleSignal);

const raceWithShutdown = <T>(operation: Promise<T>): Promise<T> =>
  Promise.race([
    operation,
    shutdown.then((signal) => {
      throw new ShutdownRequested(signal);
    }),
  ]);

try {
  serverTree = spawnProcessTree(
    npmCommand,
    ['run', 'dev:e2e'],
    {
      env: {
        ...process.env,
        MERMAID_WORKBENCH_DATA_DIR: e2eDataDirectory,
      },
      stdio: 'inherit',
    },
  );
  const serverExit = waitForProcessExit(serverTree);
  await raceWithShutdown(waitForServer(serverExit));

  playwrightTree = spawnProcessTree(
    process.execPath,
    [playwrightCli, 'test', ...process.argv.slice(2)],
    {
      env: {
        ...process.env,
        MERMAID_WORKBENCH_E2E_DATA_DIR: e2eDataDirectory,
      },
      stdio: 'inherit',
    },
  );
  const playwrightExit = await raceWithShutdown(
    waitForProcessExit(playwrightTree),
  );
  exitCode =
    playwrightExit.code ??
    (playwrightExit.signal
      ? signalExitCode(playwrightExit.signal)
      : 1);
} catch (error) {
  if (error instanceof ShutdownRequested) {
    exitCode = signalExitCode(error.signal);
  } else {
    throw error;
  }
} finally {
  process.off('SIGINT', handleSignal);
  process.off('SIGTERM', handleSignal);
  const processTrees = [playwrightTree, serverTree].filter(
    (processTree): processTree is ProcessTree => processTree !== null,
  );
  const terminationResults = await Promise.allSettled(
    processTrees.map((processTree) =>
      terminateProcessTree(processTree),
    ),
  );
  const terminationErrors = terminationResults
    .filter(
      (result): result is PromiseRejectedResult =>
        result.status === 'rejected',
    )
    .map((result) => result.reason);
  if (terminationErrors.length > 0) {
    throw new AggregateError(
      terminationErrors,
      'Could not terminate every E2E process tree.',
    );
  }
  cleanupE2eDataDirectory(e2eDataDirectory);
}

process.exitCode = exitCode;
