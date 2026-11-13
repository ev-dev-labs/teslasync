import { defineConfig, devices } from '@playwright/test';
import { CAPTURE_VIEWPORTS } from './design-packs-capture';

const port = Number(process.env.DESIGN_PACK_CAPTURE_PORT ?? 49873);
if (!Number.isInteger(port) || port < 1024 || port > 65535) {
  throw new Error('DESIGN_PACK_CAPTURE_PORT must be a TCP port from 1024 to 65535');
}
const baseURL = process.env.DESIGN_PACK_CAPTURE_BASE_URL ?? `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: '.',
  testMatch: /design-packs-capture\.spec\.ts$/,
  outputDir: process.env.DESIGN_PACK_CAPTURE_OUTPUT_DIR ?? `../test-results-design-packs-capture/${port}`,
  fullyParallel: true,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  use: {
    ...devices['Desktop Chrome'],
    channel: process.env.DESIGN_PACK_BROWSER_CHANNEL ?? 'chrome',
    baseURL,
    locale: 'en-US',
    timezoneId: 'UTC',
    reducedMotion: 'reduce',
    serviceWorkers: 'block',
    hasTouch: process.env.DESIGN_PACK_TOUCH_DEVICE === '1',
    actionTimeout: 15_000,
    screenshot: process.env.DESIGN_PACK_VIEWPORT_ONLY === '1' ? 'off' : 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: CAPTURE_VIEWPORTS.flatMap(viewport =>
    (['dark', 'light'] as const).map(mode => ({
      name: mode === 'dark' ? viewport.name : `${viewport.name}-light`,
      use: {
        viewport: { width: viewport.width, height: viewport.height },
        colorScheme: mode,
      },
    }))),
});
