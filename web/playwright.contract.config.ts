import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  testMatch: /harness\.contract\.spec\.ts/,
  fullyParallel: false,
  reporter: [['line']],
  projects: [{ name: 'harness-contract' }],
});
