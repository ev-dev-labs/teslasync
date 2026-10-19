import { defineConfig } from '@playwright/test'
export default defineConfig({
  testDir: './e2e', timeout: 180000, workers: 1, reporter: [['line']],
  outputDir: '../.sidenav-vite-cache/ui-fixes-results',
  use: { baseURL: 'http://127.0.0.1:3101', channel: 'msedge', headless: true, serviceWorkers: 'block' },
  projects: [{ name: 'ui-fixes-edge', testMatch: /ui-fixes-2\.spec\.ts|sidenav-redesign\.spec\.ts|route-layout-guard\.smoke\.spec\.ts/ }],
})
