import { test } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { installApiMocks, seedBrowserState, waitForHarnessReady } from './mockApi'

/**
 * PWA asset capture (NOT a test — a generator).
 *
 * Produces the committed install/store artwork under public/:
 *  - public/screenshots/*.jpg — manifest `screenshots` for the rich install
 *    UI on Android / Windows / ChromeOS.
 *  - public/splash/*.png — iOS `apple-touch-startup-image` launch screens.
 *
 * Run: `npm run e2e:build && npm run pwa:assets`. Runs against the mocked
 * build with fixtures, so output is deterministic and contains no real
 * fleet data. Excluded from every default Playwright project (own config).
 */

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SCREENSHOTS = path.resolve(HERE, '../public/screenshots')
const SPLASH = path.resolve(HERE, '../public/splash')

// Device-pixel-exact iOS launch sizes (modern iPhones + iPads). Filenames
// encode WxH so index.html <link> tags and the contract check stay synced.
const SPLASH_SIZES: Array<[number, number]> = [
  [1170, 2532],
  [1179, 2556],
  [1206, 2622],
  [1284, 2778],
  [1290, 2796],
  [1320, 2868],
  [1668, 2388],
  [2048, 2732],
]

function splashHtml(): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
*{box-sizing:border-box;margin:0}html,body{height:100%}
body{display:flex;align-items:center;justify-content:center;background:#0b0d12;
font-family:system-ui,-apple-system,sans-serif}
.wrap{text-align:center}
.mark{width:180px;height:180px;margin:0 auto 48px;border-radius:44px;
background:linear-gradient(135deg,#00f0ff,#10b981);
display:flex;align-items:center;justify-content:center}
h1{color:#e6ebf2;font-size:64px;font-weight:700;letter-spacing:-0.02em}
</style></head><body><div class="wrap">
<div class="mark"><svg width="96" height="96" viewBox="0 0 24 24" fill="none"
stroke="#06281f" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
<path d="M13 2 3 14h7l-1 8 10-12h-7l1-8z"/></svg></div>
<h1>TeslaSync</h1></div></body></html>`
}

test.describe.configure({ mode: 'serial' })

test('capture manifest screenshots', async ({ page }) => {
  await seedBrowserState(page, 'dark', '/')
  await installApiMocks(page)

  // Narrow (phone) — dashboard.
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await waitForHarnessReady(page)
  await page.getByRole('main').waitFor()
  await page.screenshot({
    path: path.join(SCREENSHOTS, 'screenshot-narrow.jpg'),
    type: 'jpeg',
    quality: 75,
    animations: 'disabled',
    caret: 'hide',
  })

  // Wide (desktop) — fleet overview.
  await page.setViewportSize({ width: 1280, height: 720 })
  await page.goto('/vehicles')
  await waitForHarnessReady(page)
  await page.getByRole('main').waitFor()
  await page.screenshot({
    path: path.join(SCREENSHOTS, 'screenshot-wide.jpg'),
    type: 'jpeg',
    quality: 75,
    animations: 'disabled',
    caret: 'hide',
  })
})

test('capture iOS splash screens', async ({ page }) => {
  for (const [width, height] of SPLASH_SIZES) {
    await page.setViewportSize({ width, height })
    await page.setContent(splashHtml())
    await page.screenshot({
      path: path.join(SPLASH, `splash-${width}x${height}.png`),
      animations: 'disabled',
      caret: 'hide',
    })
  }
})
