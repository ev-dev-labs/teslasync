import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright E2E config — P1 #9.
 *
 * Smoke-tests the SPA's critical user paths (login, dashboard load,
 * navigation) without depending on a running backend. The tests mock
 * the network layer via Playwright's `page.route()` interception so
 * they exercise REAL React rendering + routing + i18n without
 * coupling to backend availability — that means CI can run them in
 * the same job as the existing Vitest suite without spinning up a
 * full stack.
 *
 * For full-stack E2E (vehicles flow with a live API + DB), a separate
 * job under .github/workflows would be the right place — that work is
 * deferred to a follow-up because it requires testcontainers wiring
 * for TimescaleDB + Redis + the backend binary.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npx vite --host 127.0.0.1 --port 5173',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
