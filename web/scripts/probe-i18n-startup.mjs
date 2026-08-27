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

const baseURL = process.env.LOCALE_PROBE_BASE_URL ?? 'http://127.0.0.1:4173'
const STRICT = process.argv.includes('--strict')
const __dirname = dirname(fileURLToPath(import.meta.url))
const ASSETS_DIR = join(__dirname, '..', 'dist', 'assets')
const MAX_ROUTE_LOCALE_REQUESTS = 5

async function captureLocaleRequests(browser, path) {
  const page = await browser.newPage({ serviceWorkers: 'block' })
  await page.addInitScript(() => {
    window.__TESLASYNC_I18N_PROBE_KEYS__ = []
  })
  const requests = new Set()
  const i18nErrors = []
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (/\/assets\/locale-[^/]+\.js$/i.test(url.pathname)) requests.add(url.pathname)
  })
  page.on('console', (message) => {
    if (/\[i18n\]\s+Failed to load English namespace/.test(message.text())) {
      i18nErrors.push(message.text())
    }
  })
  await page.goto(new URL(path, baseURL).toString(), { waitUntil: 'networkidle' })
  await page.waitForTimeout(250)
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
  const browser = await chromium.launch({ headless: true })
  try {
    const notFound = await captureLocaleRequests(browser, '/__locale-shell-probe__')
    const dashboard = await captureLocaleRequests(browser, '/')
    const drives = await captureLocaleRequests(browser, '/drives')
    const charging = await captureLocaleRequests(browser, '/charging')
    const vehicles = await captureLocaleRequests(browser, '/vehicles')
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
    await browser.close()
  }
}

main().catch((error) => {
  console.error('[i18n-runtime] probe failed:', error)
  process.exit(1)
})
