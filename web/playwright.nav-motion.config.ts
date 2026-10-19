import { defineConfig } from '@playwright/test'
export default defineConfig({
  testDir: './e2e', timeout: 180000, workers: 1, reporter: [['line']],
  outputDir: '../.sidenav-vite-cache/nav-motion-results',
  use: { baseURL: 'http://127.0.0.1:3102', channel: 'msedge', headless: true, serviceWorkers: 'block' },
  projects: [{ name: 'nav-motion-edge', testMatch: /nav-motion\.spec\.ts|sidenav-redesign\.spec\.ts|route-layout-guard\.smoke\.spec\.ts/ }],
})
