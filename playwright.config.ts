import { defineConfig } from '@playwright/test';

delete process.env.NO_COLOR;

const e2eDataDirectory = `./work/e2e-data-${process.pid}`;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:5173',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run dev:e2e',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      MERMAID_WORKBENCH_DATA_DIR: e2eDataDirectory,
    },
  },
});
