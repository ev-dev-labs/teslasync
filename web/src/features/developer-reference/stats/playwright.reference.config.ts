import { defineConfig } from '@playwright/test';

/** No server boot, screenshots, production test edits or jobs before parent resource grant. */
export default defineConfig({
  testDir: '.',
  testMatch: 'stats-reference.browser.spec.ts',
  workers: 1,
  use: {
    baseURL: process.env.STAT_REFERENCE_BASE_URL ?? 'http://localhost:5238',
    storageState: process.env.STAT_REFERENCE_STORAGE_STATE,
  },
});
