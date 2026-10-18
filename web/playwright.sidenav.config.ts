import { defineConfig } from '@playwright/test'
export default defineConfig({ testDir:'./e2e', timeout:180000, workers:1, reporter:[['line']], use:{baseURL:'http://127.0.0.1:3100',channel:'msedge',headless:true,serviceWorkers:'block'}, projects:[{name:'sidenav-edge',testMatch:/route-layout-guard\.smoke\.spec\.ts|sidenav-redesign\.spec\.ts/}] })
