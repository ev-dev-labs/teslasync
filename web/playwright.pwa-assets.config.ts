import { defineConfig, devices } from '@playwright/test';
import { baseConfig } from './playwright.config';

// Optional local fallback when Playwright's WebKit download is unavailable.
const webkitExecutable = process.env.PWA_WEBKIT_EXECUTABLE;
const webkitOverride = webkitExecutable
  ? { launchOptions: { executablePath: webkitExecutable } }
  : {};

// Standalone config for PWA artwork + device review. Deliberately NOT part
// of the default projects: these specs write files (committed install
// assets, uncommitted review screenshots) and must only run on demand:
//
//   npm run e2e:build && npm run pwa:assets            # committed assets
//   npm run e2e:build && npm run pwa:devices           # review screenshots
export default defineConfig({
  ...baseConfig,
  testDir: './e2e',
  outputDir: './test-results-pwa-assets',
  projects: [
    {
      name: 'pwa-assets',
      testMatch: /pwa-assets\.capture\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'device-iphone',
      testMatch: /pwa-(?:devices\.capture|navigation)\.spec\.ts/,
      use: { ...devices['iPhone 14'], ...webkitOverride },
    },
    {
      name: 'device-ipad',
      testMatch: /pwa-(?:devices\.capture|navigation)\.spec\.ts/,
      use: { ...devices['iPad Pro 11'], ...webkitOverride },
    },
    {
      name: 'device-android',
      testMatch: /pwa-(?:devices\.capture|navigation)\.spec\.ts/,
      use: { ...devices['Pixel 7'] },
    },
    {
      name: 'device-desktop-windows',
      testMatch: /pwa-devices\.capture\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
      },
    },
    {
      name: 'device-desktop-macos',
      testMatch: /pwa-devices\.capture\.spec\.ts/,
      use: {
        ...devices['Desktop Safari'],
        viewport: { width: 1440, height: 900 },
        ...webkitOverride,
      },
    },
  ],
});
