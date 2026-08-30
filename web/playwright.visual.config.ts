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
      metadata: { visualProfile: 'core' },
      use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 }, colorScheme: 'dark' },
    },
    {
      name: 'visual-390-light',
      metadata: { visualProfile: 'core' },
      use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 }, colorScheme: 'light' },
    },
    {
      name: 'visual-1440-dark',
      metadata: { visualProfile: 'core' },
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 }, colorScheme: 'dark' },
    },
    {
      name: 'visual-1440-light',
      metadata: { visualProfile: 'core' },
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 }, colorScheme: 'light' },
    },
    {
      name: 'visual-density-compact',
      metadata: { visualProfile: 'density', density: 'compact' },
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 }, colorScheme: 'dark' },
    },
    {
      name: 'visual-density-spacious',
      metadata: { visualProfile: 'density', density: 'spacious' },
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 }, colorScheme: 'dark' },
    },
    {
      name: 'visual-long-content',
      metadata: { visualProfile: 'long-content' },
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 }, colorScheme: 'dark' },
    },
    {
      name: 'visual-large-fleet',
      metadata: { visualProfile: 'large-fleet' },
      use: { ...devices['Desktop Chrome'], viewport: { width: 1920, height: 1080 }, colorScheme: 'dark' },
    },
    {
      name: 'visual-degraded',
      metadata: { visualProfile: 'degraded' },
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 }, colorScheme: 'dark' },
    },
    {
      name: 'visual-forced-colors',
      metadata: { visualProfile: 'forced-colors' },
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
        colorScheme: 'dark',
        forcedColors: 'active',
      },
    },
  ],
});
