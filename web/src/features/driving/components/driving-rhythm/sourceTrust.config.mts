import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('../../../../', import.meta.url)) },
  },
  test: {
    execArgv: ['--no-experimental-webstorage'],
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    include: ['src/features/driving/components/driving-rhythm/sourceTrust.test.tsx'],
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
