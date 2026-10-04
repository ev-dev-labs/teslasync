import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// Isolated regression runner: deliberately avoids the deployment catalog
// generation gate while concurrent feature owners edit English source keys.
// Uses the same environment/setup as the application Vitest configuration.
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('../../../../../', import.meta.url)),
    },
  },
  test: {
    execArgv: ['--no-experimental-webstorage'],
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    include: [
      'src/features/driving/components/driving-dynamics/**/*.test.{ts,tsx}',
      'src/features/driving/pages/DrivingDynamicsPage.test.tsx',
    ],
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
