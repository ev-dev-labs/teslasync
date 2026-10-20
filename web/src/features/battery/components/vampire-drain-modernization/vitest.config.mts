import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// Keep this regression runnable independently of unrelated catalog-generation drift.
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('../../../../', import.meta.url)),
    },
  },
  test: {
    execArgv: ['--no-experimental-webstorage'],
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    include: ['src/features/battery/components/vampire-drain-modernization/VampireCulpritPanel.test.tsx'],
    maxWorkers: 1,
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
