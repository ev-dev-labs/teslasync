#!/usr/bin/env node
/**
 * Headless cold-start guard for generated locale bundles.
 *
 * Run against `vite preview` after a production build. The NotFound route
 * must be fully covered by the static shell; Dashboard may request only its
 * route-owned locale bundle.
 */
import { chromium } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'
import { createServer } from 'vite'
import { setTimeout as delay } from 'node:timers/promises'

const baseURL = process.env.LOCALE_PROBE_BASE_URL ?? 'http://127.0.0.1:4173'
const STRICT = process.argv.includes('--strict')
const __dirname = dirname(fileURLToPath(import.meta.url))
const ASSETS_DIR = join(__dirname, '..', 'dist', 'assets')
const MAX_ROUTE_LOCALE_REQUESTS = 5

async function loadApiFixtures() {
  const loader = await createServer({
    root: join(__dirname, '..'),
    configFile: false,
    server: { middlewareMode: true, hmr: false },
    optimizeDeps: { noDiscovery: true, include: [] },
  })
  try {
    return await loader.ssrLoadModule('/e2e/mockApi.ts')
  } finally {
    await loader.close()
  }
}

async function captureLocaleRequests(browser, path, fixtures) {
  const page = await browser.newPage({ serviceWorkers: 'block' })
  const api = await fixtures.installApiMocks(page, 'populated', 'dark')
  if (!api) throw new Error('Locale measurement requires API fixtures; E2E_MOCKS=0 is unsupported')
  // Remote paint renders are unrelated to locale closure. Keep a slow Tesla
  // CDN from blocking measurement without seeding away first-visit app behavior.
  await page.route('https://static-assets.tesla.com/configurator/compositor**', route =>
    route.fulfill({
      status: 200,
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>',
    }),
  )
  await page.route('**/api/v1/onboarding/status', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        setup_complete: true,
        setup_required: false,
        is_complete: true,
        tesla_connected: true,
        vehicle_count: 1,
        data_flowing: true,
      }),
    }),
  )
  await page.addInitScript(() => {
    window.__TESLASYNC_I18N_PROBE_KEYS__ = []
  })
  const requests = new Set()
  const pendingLocales = new Set()
  let lastLocaleActivity = Date.now()
  const i18nErrors = []
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (/\/assets\/locale-[^/]+\.js$/i.test(url.pathname)) {
      requests.add(url.pathname)
      pendingLocales.add(request)
      lastLocaleActivity = Date.now()
    }
  })
  const finishLocale = (request) => {
    if (pendingLocales.delete(request)) lastLocaleActivity = Date.now()
  }
  page.on('requestfinished', finishLocale)
  page.on('requestfailed', finishLocale)
  page.on('console', (message) => {
    if (/\[i18n\]\s+Failed to load English namespace/.test(message.text())) {
      i18nErrors.push(message.text())
    }
  })
  await page.goto(new URL(path, baseURL).toString(), { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('main', { timeout: 30_000 })
  // Healthy SSE never becomes network-idle. Await the actual API/locale
  // closure, without seeding away first-visit dialogs or application state.
  const deadline = Date.now() + 30_000
  while (api.pending > 0 || pendingLocales.size > 0
    || Date.now() - Math.max(api.lastActivityAt, lastLocaleActivity) < 750) {
    if (Date.now() >= deadline) {
      throw new Error(`Locale closure did not settle on ${path}: ${api.pending} API, ${pendingLocales.size} locale requests pending`)
    }
    await delay(100)
  }
  if (api.unmatched.size > 0 || api.invalidRum.length > 0) {
    throw new Error(`Invalid locale-probe fixtures on ${path}: ${JSON.stringify({
      unmatched: [...api.unmatched], invalidRum: api.invalidRum,
    })}`)
  }
  await delay(250)
  const missingKeys = await page.evaluate(() => window.__TESLASYNC_I18N_PROBE_KEYS__ ?? [])
  await page.close()
  return { requests: [...requests].sort(), i18nErrors, missingKeys }
}

function localeByteSummary(requests) {
  return requests.map((request) => {
    const file = request.split('/').pop()
    const contents = readFileSync(join(ASSETS_DIR, file))
    return `${file} (${contents.length} raw / ${gzipSync(contents).length} gzip bytes)`
  })
}

async function main() {
  const fixtures = await loadApiFixtures()
  const browser = await chromium.launch({ headless: true })
  try {
    const notFound = await captureLocaleRequests(browser, '/__locale-shell-probe__', fixtures)
    const dashboard = await captureLocaleRequests(browser, '/', fixtures)
    const drives = await captureLocaleRequests(browser, '/drives', fixtures)
    const charging = await captureLocaleRequests(browser, '/charging', fixtures)
    const vehicles = await captureLocaleRequests(browser, '/vehicles', fixtures)
    const routes = [
      ['cold NotFound', notFound],
      ['Dashboard', dashboard],
      ['Drives', drives],
      ['Charging', charging],
      ['Vehicles', vehicles],
    ]
    const i18nErrors = routes.flatMap(([, result]) => result.i18nErrors)
    for (const [name, result] of routes) {
      console.log(
        `[i18n-runtime] ${name}: ${result.requests.length} deferred locale requests${result.requests.length ? ` (${localeByteSummary(result.requests).join(', ')})` : ''}${result.missingKeys.length ? `; missing keys: ${result.missingKeys.join(', ')}` : ''}`,
      )
    }
    console.log(`[i18n-runtime] missing namespace console errors: ${i18nErrors.length}`)

    // Dashboard composes its route bundle with shared display primitives and
    // live telemetry widgets. Cap this known component closure at three
    // locale requests so a future grouping change cannot fan out broadly.
    if (
      STRICT
      && (notFound.requests.length > 0
        || [dashboard, drives, charging, vehicles].some((result) => result.requests.length > MAX_ROUTE_LOCALE_REQUESTS)
        || i18nErrors.length > 0)
    ) {
      console.error(`[i18n-runtime] expected shell-only NotFound and at most ${MAX_ROUTE_LOCALE_REQUESTS} locale bundles per route closure`)
      process.exitCode = 1
    }
  } finally {
    try {
      await browser.close()
    } finally {
      await fixtures.closeMockApiFixtures()
    }
  }
}

main().catch((error) => {
  console.error('[i18n-runtime] probe failed:', error)
  process.exit(1)
})
