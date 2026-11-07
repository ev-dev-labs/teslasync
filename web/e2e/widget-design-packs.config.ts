import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const cwd = fileURLToPath(new URL('..', import.meta.url));

export default defineConfig({
  testDir: '.',
  testMatch: /widget-design-packs\.(?:initial|settings|climate|complete|signals)\.spec\.ts$/,
  outputDir: '../test-results/widget-design-packs',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 180_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:4189',
    locale: 'en-US',
    timezoneId: 'UTC',
    reducedMotion: 'reduce',
    serviceWorkers: 'block',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run preview -- --host 127.0.0.1 --port 4189 --strictPort',
    cwd,
    url: 'http://127.0.0.1:4189',
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [{
    name: 'chromium-smoke',
    use: { ...devices['Desktop Chrome'], channel: 'chrome' },
  }],
});
