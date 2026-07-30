import { defineConfig } from '@playwright/test';

delete process.env.NO_COLOR;

const e2eDataDirectory =
  process.env.MERMAID_WORKBENCH_E2E_DATA_DIR;
if (!e2eDataDirectory) {
  throw new Error(
    'Run browser tests through npm run test:e2e to isolate their data.',
  );
}

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:5173',
    trace: 'retain-on-failure',
  },
});
