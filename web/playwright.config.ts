import { defineConfig, devices } from '@playwright/test'

/**
 * Playwright E2E configuration — gold-standard rewrite scaffold
 * (frontend-gold-standard/p1-tooling/0003-playwright-scaffold).
 *
 * Scope is intentionally minimal: this unit wires up the runner (two
 * projects + a dev-server fixture) and a single smoke test proving the
 * SPA boots and the dashboard route renders. The full per-page suite is
 * generated later by the p8-e2e-pages program against this same config.
 *
 * `webServer` boots the Vite dev server directly with no Go API/DB/MQTT
 * stack required. Tests are responsible for stubbing `/api/v1/*` via
 * `page.route()` before navigating — see e2e/smoke.spec.ts's `stubApi()`
 * for why that's required (the app's resilience layer treats an
 * unreachable/malformed API as a proxy session-expiry signal and
 * hard-navigates away, so an un-stubbed run never settles on any route).
 */
// Deliberately NOT 3000 (vite.config.ts's normal dev port) — this repo's
// docker-compose stack runs Grafana on :3000 on shared dev hosts, so a
// fixed, distinct port avoids colliding with it (or with other frontend
// dev servers) when running `npm run test:e2e` locally alongside other
// running services. CI runners are isolated per-job so any port works
// there; this only matters for local/shared-machine ergonomics.
//
// `localhost` (not `127.0.0.1`) — Vite's dev server (no explicit `host`
// config) binds only the resolved-`localhost` loopback address, which is
// IPv6 (`::1`) on many hosts/CI images. Hardcoding the IPv4 literal makes
// the webServer health-check connect-refuse and time out on those hosts.
const PORT = 4300
const BASE_URL = `http://localhost:${PORT}`

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  // 60s (default is 30s) — the dev server compiles routes on demand, and a
  // cold first request through App.tsx's ~150 lazy route chunks plus the
  // React Compiler babel transform can be slower on a shared CI runner than
  // the default budget assumes.
  timeout: 60_000,
  reporter: process.env.CI
    ? [['html', { open: 'never' }], ['github'], ['list']]
    : 'list',
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  projects: [
    {
      name: 'desktop-chrome',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
    {
      name: 'mobile-safari',
      use: { ...devices['iPhone 14'] },
    },
  ],
  webServer: {
    command: `npm run dev -- --port ${PORT} --strictPort`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
})
