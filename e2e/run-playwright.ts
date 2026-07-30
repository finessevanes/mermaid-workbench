import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import {
  cleanupE2eDataDirectory,
  createE2eDataDirectory,
} from '../src/test-support/e2e-data-directory';

const e2eDataDirectory = createE2eDataDirectory();
const playwrightCli = createRequire(import.meta.url).resolve(
  '@playwright/test/cli',
);

try {
  const exitCode = await new Promise<number>((resolve, reject) => {
    const child = spawn(
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
    const forwardSignal = (signal: NodeJS.Signals) => {
      child.kill(signal);
    };
    const finish = (
      code: number | null,
      signal: NodeJS.Signals | null,
    ) => {
      process.off('SIGINT', forwardSignal);
      process.off('SIGTERM', forwardSignal);
      resolve(
        code ??
          (signal === 'SIGINT'
            ? 130
            : signal === 'SIGTERM'
              ? 143
              : 1),
      );
    };
    process.once('SIGINT', forwardSignal);
    process.once('SIGTERM', forwardSignal);
    child.once('error', (error) => {
      process.off('SIGINT', forwardSignal);
      process.off('SIGTERM', forwardSignal);
      reject(error);
    });
    child.once('exit', finish);
  });
  process.exitCode = exitCode;
} finally {
  cleanupE2eDataDirectory(e2eDataDirectory);
}
