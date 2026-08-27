import { defineConfig, devices } from '@playwright/test';
import { baseConfig } from './playwright.config';

export default defineConfig({
  ...baseConfig,
  testMatch: /visual\.spec\.ts/,
  fullyParallel: true,
  workers: 4,
  timeout: 60_000,
  projects: [
    {
      name: 'visual-390-dark',
      use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 }, colorScheme: 'dark' },
    },
    {
      name: 'visual-1440-dark',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 }, colorScheme: 'dark' },
    },
    {
      name: 'visual-1440-light',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 }, colorScheme: 'light' },
    },
  ],
});
