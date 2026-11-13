import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  testMatch: /harness\.contract\.spec\.ts/,
  fullyParallel: false,
  reporter: [['line']],
  use: { channel: process.env.DESIGN_PACK_BROWSER_CHANNEL },
  projects: [{ name: 'harness-contract' }],
});
