import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const cwd = fileURLToPath(new URL('..', import.meta.url));
const baseURL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:4189';

export default defineConfig({
  testDir: '.',
  testMatch: /widget-design-packs\.(?:initial|settings|climate|complete|signals|sync|app)\.spec\.ts$/,
  outputDir: '../test-results/widget-design-packs',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 600_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  use: {
    baseURL,
    locale: 'en-US',
    timezoneId: 'UTC',
    reducedMotion: 'reduce',
    serviceWorkers: 'block',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `npm run preview -- --host 127.0.0.1 --port ${new URL(baseURL).port} --strictPort`,
    cwd,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [{
    name: 'chromium-smoke',
    use: { ...devices['Desktop Chrome'], channel: 'chrome' },
  }],
});
