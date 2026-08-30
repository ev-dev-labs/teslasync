import { defineConfig, devices, type PlaywrightTestConfig } from '@playwright/test';
import { isSensitiveRun, resolveStorageState } from './e2e/configEnv';

const explicitBaseURL = process.env.E2E_BASE_URL;
const baseURL = explicitBaseURL ?? 'http://127.0.0.1:4173';
const storageStatePath = resolveStorageState(process.env);
const sensitiveRun = isSensitiveRun(process.env);
const mocksEnabled = process.env.E2E_MOCKS !== '0';

const viewportProjects = [390, 768, 1024, 1440, 1920].flatMap((width) =>
  (['dark', 'light'] as const).map((theme) => ({
    name: `chromium-${width}-${theme}`,
    testMatch: /routes\.quality\.spec\.ts/,
    use: {
      ...devices['Desktop Chrome'],
      colorScheme: theme,
      viewport: { width, height: width === 390 ? 844 : 900 },
    },
  })),
);

export const baseConfig: PlaywrightTestConfig = {
  testDir: './e2e',
  outputDir: './test-results',
  snapshotPathTemplate: '{testDir}/.snapshots/{projectName}/{testFilePath}/{arg}{ext}',
  timeout: 30_000,
  expect: { timeout: 8_000 },
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: sensitiveRun
    ? [['line']]
    : process.env.CI
    ? [['line'], ['html', { outputFolder: 'playwright-report', open: 'never' }], ['json', { outputFile: 'test-results/results.json' }]]
    : [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
  use: {
    baseURL,
    storageState: storageStatePath,
    actionTimeout: 8_000,
    navigationTimeout: 20_000,
    screenshot: sensitiveRun ? 'off' : 'only-on-failure',
    trace: sensitiveRun ? 'off' : 'retain-on-failure',
    video: sensitiveRun ? 'off' : 'retain-on-failure',
    // A controlled service worker can satisfy API reads before page.route()
    // sees them. Block it for hermetic fixtures; deployed smoke still exercises
    // the production worker with E2E_MOCKS=0.
    serviceWorkers: mocksEnabled ? 'block' : 'allow',
    locale: 'en-US',
    timezoneId: 'UTC',
  },
  webServer: explicitBaseURL || process.env.E2E_SKIP_WEBSERVER
    ? undefined
    : {
        command: 'npm run preview -- --outDir e2e/.app-dist --host 127.0.0.1 --port 4173 --strictPort',
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
  projects: [
    ...viewportProjects,
    {
      name: 'chromium-smoke',
      testMatch: /\.smoke\.spec\.ts/,
      testIgnore: [/performance\.perf\.spec\.ts/, /accessibility\.smoke\.spec\.ts/],
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 }, colorScheme: 'dark' },
    },
    {
      name: 'chromium-a11y',
      testMatch: /accessibility\.smoke\.spec\.ts/,
      fullyParallel: false,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 }, colorScheme: 'dark' },
    },
    {
      name: 'chromium-performance',
      testMatch: /performance\.perf\.spec\.ts/,
      fullyParallel: false,
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
        colorScheme: 'dark',
        screenshot: 'off',
        trace: 'off',
        video: 'off',
      },
    },
    {
      name: 'firefox-smoke',
      testMatch: /cross-browser\.smoke\.spec\.ts/,
      use: { ...devices['Desktop Firefox'], viewport: { width: 1440, height: 900 }, colorScheme: 'dark' },
    },
    {
      name: 'webkit-smoke',
      testMatch: /cross-browser\.smoke\.spec\.ts/,
      use: { ...devices['Desktop Safari'], viewport: { width: 1440, height: 900 }, colorScheme: 'dark' },
    },
    {
      name: 'harness-contract',
      testMatch: /harness\.contract\.spec\.ts/,
    },
  ],
};

export default defineConfig(baseConfig);
