import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// Isolate these regressions from unrelated generated-catalog startup checks.
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
    include: [
      'src/features/charging/components/charging-thermal-tax-modernization/thermalPresentation.test.ts',
      'src/features/charging/components/charging-thermal-tax-modernization/callerImports.test.ts',
      'src/features/charging/components/charging-thermal-tax-modernization/ThermalPowerChart.test.tsx',
      'src/features/charging/components/charging-thermal-tax-modernization/ChargingThermalTaxPage.runtime.test.tsx',
    ],
    maxWorkers: 1,
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
