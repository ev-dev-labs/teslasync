import { defineConfig } from '@playwright/test';
import { baseConfig } from './playwright.config';

export default defineConfig({
  ...baseConfig,
  workers: 1,
  reporter: [['line']],
  use: { ...baseConfig.use, screenshot: 'off', video: 'off' },
  projects: baseConfig.projects?.map(project => ({
    ...project,
    use: { ...project.use, ...(project.name?.startsWith('chromium') ? { channel: 'msedge' } : {}) },
  })),
});
