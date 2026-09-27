import { test } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { installApiMocks, seedBrowserState, waitForHarnessReady } from './mockApi'

/**
 * Cross-device review screenshots (NOT committed, NOT a test).
 *
 * Renders the app on emulated iPhone / iPad / Android / Windows / macOS
 * profiles into web/test-results-pwa-assets/devices/ for visual review.
 * Browsers approximate the real platforms: WebKit ≈ iOS Safari and macOS
 * Safari, Chromium ≈ Android Chrome and Windows Edge/Chrome.
 *
 * Run: `npm run e2e:build && npx playwright test
 * --config=playwright.pwa-assets.config.ts -g "device review"`.
 * Requires the webkit + chromium Playwright browsers.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.resolve(HERE, '../test-results-pwa-assets/devices')

test.describe.configure({ mode: 'serial' })

test('device review: dashboard', async ({ page }, testInfo) => {
  await seedBrowserState(page, 'dark', '/')
  await installApiMocks(page)
  await page.goto('/')
  await waitForHarnessReady(page)
  await page.getByRole('main').waitFor()
  await page.screenshot({
    path: path.join(OUT, `${testInfo.project.name}.png`),
    animations: 'disabled',
    caret: 'hide',
  })
})

test('device review: fleet', async ({ page }, testInfo) => {
  // Fleet page only where the desktop layout shows it best; phones/tablets
  // already prove the responsive shell via the dashboard shot.
  test.skip(
    !testInfo.project.name.startsWith('device-desktop'),
    'fleet review is desktop-only',
  )
  await seedBrowserState(page, 'dark', '/vehicles')
  await installApiMocks(page)
  await page.goto('/vehicles')
  await waitForHarnessReady(page)
  await page.getByRole('main').waitFor()
  await page.screenshot({
    path: path.join(OUT, `${testInfo.project.name}-fleet.png`),
    animations: 'disabled',
    caret: 'hide',
  })
})
