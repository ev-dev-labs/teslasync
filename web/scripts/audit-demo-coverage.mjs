import { readFileSync, writeFileSync } from 'node:fs'
import { chromium } from 'playwright'

const source = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
const routeMatches = [...source.matchAll(/<Route\s+(?:index|path="([^"]+)")\s+element=\{<SafeRoute\b/g)]
const routes = [...new Set(routeMatches.map(([, path]) => path ?? '').filter(path => path !== '*'))]
const selected = process.argv.filter(arg => arg.startsWith('--route=')).map(arg => arg.slice(8))
const output = process.argv.find(arg => arg.startsWith('--output='))?.slice(9)
const base = process.env.DEMO_BASE_URL ?? 'http://127.0.0.1:4173'
const origin = new URL(base).origin

function concretePath(path) {
  return path.replace(/:([^/]+)/g, (_, parameter) => {
    if (parameter === 'year') return String(new Date().getUTCFullYear())
    if (parameter === 'token') return 'sample-link'
    if (parameter === 'vin') return '5YJMOCK0000000001'
    if (parameter === 'id' || parameter === 'vehicleId') {
      if (path.startsWith('charging/')) return '201'
      if (path.startsWith('drives/')) return '101'
      return '7'
    }
    return 'sample'
  })
}

const targets = selected.length
  ? selected.map(route => {
    if (!routes.includes(route)) throw new Error(`Unknown SafeRoute: ${route}`)
    return route
  })
  : routes

const browser = await chromium.launch()
const context = await browser.newContext({ serviceWorkers: 'block' })
await context.addInitScript(() => {
  const OriginalResponse = window.Response
  window.__demoMissing = []
  window.Response = class extends OriginalResponse {
    constructor(body, init) {
      super(body, init)
      if (init?.status === 404 && typeof body === 'string') {
        try {
          const parsed = JSON.parse(body)
          if (parsed.code === 'DEMO_NOT_AVAILABLE') window.__demoMissing.push(parsed.error)
        } catch {
          // Only JSON error envelopes from the fixture transport are relevant.
        }
      }
    }
  }
})

const page = await context.newPage()
const networkLeaks = new Set()
const interactionErrors = []
const pageErrors = []
page.on('pageerror', error => pageErrors.push(String(error)))
await page.route('**/*', route => {
  const url = route.request().url()
  if (url.startsWith('http') && new URL(url).origin !== origin) {
    return route.abort()
  }
  if (/^\/(?:api|demo-api)\/v1\//.test(new URL(url).pathname)) {
    networkLeaks.add(url)
    return route.abort()
  }
  return route.continue()
})

const rows = []
try {
  for (const route of targets) {
    pageErrors.length = 0
    let navigationError = null
    try {
      await page.goto(new URL(`/${concretePath(route)}`, base).href, { waitUntil: 'domcontentloaded', timeout: 20_000 })
      await page.waitForTimeout(1250)
    } catch (error) {
      navigationError = String(error)
    }
    const result = navigationError ? { missing: [], contentChars: 0, sections: 0, title: '' } : await page.evaluate(() => ({
      missing: [...new Set(window.__demoMissing ?? [])],
      contentChars: (document.querySelector('main') ?? document.querySelector('[data-role="page-container"]'))
        ?.textContent?.trim().length ?? 0,
      sections: document.querySelectorAll('main section, [data-role="page-container"] section').length,
      title: document.title,
    }))
    rows.push({ route, ...result, navigationError, pageErrors: [...pageErrors] })
    if (process.argv.includes('--interactions') && !navigationError
      && ['quick-stats', 'analytics', 'fsd', 'mileage'].includes(route)) {
      try {
        if (route === 'quick-stats') {
          await page.getByText('Fleet Comparison', { exact: true }).first().waitFor()
          await page.getByRole('combobox', { name: 'Select vehicle' }).selectOption('8')
          await page.getByRole('heading', { name: 'Comet', exact: true }).waitFor()
          await page.getByRole('button', { name: 'Refresh quick stats' }).click()
        } else if (route === 'analytics') {
          const nav = page.getByRole('navigation', { name: 'Analytics sections' })
          for (const label of ['Driving', 'Charging', 'Battery', 'Overview']) {
            await nav.getByRole('button', { name: label }).click()
            await nav.getByRole('button', { name: label }).getAttribute('aria-pressed')
              .then(value => {
                if (value !== 'true') throw new Error(`${label} tab did not activate`)
              })
          }
        } else if (route === 'fsd') {
          await page.getByTestId('fsd-confidence').waitFor()
          if (await page.locator('[data-role="metric-card"]').count() === 0) {
            throw new Error('No FSD metrics rendered')
          }
        } else if (await page.locator('.recharts-wrapper').count() === 0) {
          throw new Error('No mileage chart rendered')
        }
      } catch (error) {
        interactionErrors.push({ route, error: String(error) })
      }
    }
  }
} finally {
  await browser.close()
}

const report = {
  total: rows.length,
  missingRoutes: rows.filter(row => row.missing.length > 0).length,
  distinctMissingEndpoints: new Set(rows.flatMap(row => row.missing)).size,
  emptyContentRoutes: rows.filter(row => row.contentChars === 0).map(row => row.route),
  navigationErrors: rows.filter(row => row.navigationError).map(row => row.route),
  pageErrorRoutes: rows.filter(row => row.pageErrors.length).map(row => row.route),
  networkLeaks: [...networkLeaks],
  interactionErrors,
  rows,
}
if (output) writeFileSync(output, JSON.stringify(report, null, 2))
console.log(JSON.stringify({
  total: report.total, missingRoutes: report.missingRoutes,
  distinctMissingEndpoints: report.distinctMissingEndpoints,
  emptyContentRoutes: report.emptyContentRoutes, navigationErrors: report.navigationErrors,
  pageErrorRoutes: report.pageErrorRoutes,
  networkLeaks: report.networkLeaks, interactionErrors: report.interactionErrors,
}, null, 2))
if (process.argv.includes('--strict') && (
  report.missingRoutes || report.emptyContentRoutes.length
  || report.navigationErrors.length || report.pageErrorRoutes.length
  || report.networkLeaks.length || report.interactionErrors.length
)) process.exitCode = 1
