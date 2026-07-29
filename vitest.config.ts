import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./src/client/test/setup.ts'],
    poolOptions: {
      forks: {
        execArgv: ['--disable-warning=ExperimentalWarning'],
      },
    },
    coverage: {
      reporter: ['text', 'html'],
    },
  },
  resolve: {
    alias: {
      '@client': new URL('./src/client', import.meta.url).pathname,
      '@server': new URL('./src/server', import.meta.url).pathname,
      '@shared': new URL('./src/shared', import.meta.url).pathname,
    },
  },
});
