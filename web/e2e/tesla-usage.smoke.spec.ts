import { expect, test } from '@playwright/test'
import { installApiMocks, seedBrowserState } from './mockApi'

// A locally installed Edge is a valid Chromium target when Playwright's
// bundled browser revision is unavailable on an operator workstation.
if (process.env.TESLASYNC_BROWSER_PATH) {
  test.use({ launchOptions: { executablePath: process.env.TESLASYNC_BROWSER_PATH } })
}

const point = (bucket_start: string, signals: number, commands: number, data_requests: number, wakes: number) => ({
  bucket_start, signals, commands, data_requests, wakes,
  estimated_usd: signals / 150000 + commands / 1000 + data_requests / 500 + wakes / 50,
})
const recent = [
  point('2026-09-04T00:00:00Z', 150000, 1000, 500, 50),
  point('2026-09-15T00:00:00Z', 75000, 0, 250, 0),
]
const older = point('2025-11-04T00:00:00Z', 150000, 0, 0, 0)
const current = {
  start: '2026-09-04T00:00:00Z', end: '2026-10-04T00:00:00Z',
  signals: 225000, commands: 1000, data_requests: 750, wakes: 50, estimated_usd: 5,
}
const cycle = {
  current,
  history: [
    { ...current, start: '2026-08-05T00:00:00Z', end: current.start, signals: 5, commands: 0, data_requests: 0, wakes: 0, estimated_usd: 5 / 150000 },
  ],
  rate_source: 'https://developer.tesla.com/',
  disclaimer: 'Local estimate; not an invoice.',
}
const usageRoute = /\/api\/v1\/system\/api-usage(?:\/history)?(?:\?|$)/

test('Tesla usage page and status card render desktop/mobile, light/dark and historical empty states', async ({ page }, testInfo) => {
  testInfo.setTimeout(180_000)
  await page.clock.setFixedTime(new Date('2026-09-23T00:42:00Z'))
  for (const theme of ['dark', 'light'] as const) {
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 })
      await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' })
      await seedBrowserState(page, theme, '/tesla-api-usage')
      await installApiMocks(page, 'populated', theme)
      let empty = false
      let longRange = false
      let selectedBucket = ''
      await page.route(usageRoute, async route => {
        if (route.request().url().includes('/history?')) {
          const url = new URL(route.request().url())
          selectedBucket = url.searchParams.get('bucket') ?? ''
          const start = url.searchParams.get('start') ?? ''
          longRange = Date.parse(start) < Date.parse('2026-01-01T00:00:00Z')
          const points = empty ? [] : longRange ? [older, ...recent] : recent
          const total = {
            start, end: url.searchParams.get('end'), signals: points.reduce((sum, p) => sum + p.signals, 0),
            commands: points.reduce((sum, p) => sum + p.commands, 0),
            data_requests: points.reduce((sum, p) => sum + p.data_requests, 0),
            wakes: points.reduce((sum, p) => sum + p.wakes, 0),
            estimated_usd: points.reduce((sum, p) => sum + p.estimated_usd, 0),
          }
          await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
            start, end: total.end, bucket: url.searchParams.get('bucket'), total, points,
          }) })
          return
        }
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(cycle) })
      })

      await page.goto('/tesla-api-usage')
      await expect(page.getByRole('heading', { name: 'Tesla API usage' })).toBeVisible()
      await expect(page.getByText('Current cycle and prior periods', { exact: true })).toBeVisible()
      await expect(page.getByRole('heading', { name: 'Selected-range cost distribution' })).toBeVisible()
      const trend = page.locator('figure').filter({ hasText: 'Tesla usage cost over time' })
      await expect(trend).toHaveAttribute('data-chart-state', 'ready')
      await expect(trend.locator('.recharts-bar-rectangle').first()).toBeVisible()
      const distribution = page.locator('figure').filter({ hasText: 'Selected-range cost distribution' })
      await expect(distribution.locator('.recharts-pie-sector').first()).toBeVisible()
      await distribution.screenshot({ path: testInfo.outputPath(`tesla-distribution-${theme}-${width}.png`) })
      await page.getByRole('heading', { name: 'Tesla API usage' }).evaluate(element => element.scrollIntoView({ behavior: 'instant' }))
      await page.screenshot({ path: testInfo.outputPath(`tesla-usage-${theme}-${width}-top.png`) })
      // Exercise the real chart tooltip, not a mocked component.
      await trend.locator('.recharts-bar-rectangle').first().hover()
      await expect(page.locator('.recharts-tooltip-wrapper').last()).toBeVisible()
      await page.screenshot({ path: testInfo.outputPath(`tesla-usage-${theme}-${width}-populated.png`), fullPage: true })
      await page.getByRole('button', { name: 'Date range' }).click()
      await expect(page.getByRole('option', { name: 'Last year' })).toBeVisible()
      await expect(page.locator('.rdp-month').first()).toBeVisible()
      await expect(page.getByRole('dialog', { name: 'Date range picker' }).getByRole('gridcell', { name: '20' }).first()).toBeVisible()
      const applyButton = page.getByRole('dialog', { name: 'Date range picker' }).getByRole('button', { name: 'Apply' })
      await expect.poll(async () => {
        const bounds = await applyButton.boundingBox()
        return bounds ? bounds.y + bounds.height : Number.POSITIVE_INFINITY
      }).toBeLessThan(width === 390 ? 844 - 80 : 900 - 8)
      await page.screenshot({ path: testInfo.outputPath(`tesla-usage-${theme}-${width}-picker.png`), fullPage: true })
      await page.getByRole('option', { name: 'Last year' }).click()
      await expect.poll(() => longRange).toBe(true)
      await expect(trend).toHaveAttribute('data-chart-state', 'ready')
      await expect(page.getByText('3 observed buckets')).toBeVisible()
      await trend.screenshot({ path: testInfo.outputPath(`tesla-trend-year-${theme}-${width}.png`) })
      await page.screenshot({ path: testInfo.outputPath(`tesla-usage-${theme}-${width}-year.png`), fullPage: true })
      await page.getByRole('combobox', { name: 'Group by' }).selectOption('week')
      await expect.poll(() => selectedBucket).toBe('week')
      await expect(trend).toHaveAttribute('data-chart-state', 'ready')
      await trend.screenshot({ path: testInfo.outputPath(`tesla-trend-week-${theme}-${width}.png`) })
      empty = true
      await page.getByRole('button', { name: 'Date range' }).click()
      await page.getByRole('option', { name: 'Last 90 days' }).click()
      await expect(page.locator('figure').filter({ hasText: 'Selected-range cost distribution' })).toHaveAttribute('data-chart-state', 'empty')
      await expect(trend).toHaveAttribute('data-chart-state', 'empty')
      await page.screenshot({ path: testInfo.outputPath(`tesla-usage-${theme}-${width}-empty.png`), fullPage: true })
      await page.goto('/system-status')
      await expect(page.getByRole('link', { name: 'Explore Tesla API usage' })).toBeVisible()
      await page.evaluate(() => document.querySelector('#tesla-api')?.scrollIntoView({ block: 'center', behavior: 'instant' }))
      await page.locator('#tesla-api').screenshot({ path: testInfo.outputPath(`tesla-status-card-${theme}-${width}.png`) })
      await page.screenshot({ path: testInfo.outputPath(`tesla-status-${theme}-${width}.png`) })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
      await page.unroute(usageRoute)
      await page.unroute('**/api/**')
    }
  }
})

test('custom calendar dates submit inclusive UTC days as an exclusive-end API query', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-09-23T00:42:00Z'))
  await seedBrowserState(page, 'dark', '/tesla-api-usage')
  await installApiMocks(page, 'populated', 'dark')
  let historyRange: { start: string | null; end: string | null } | null = null
  await page.route(usageRoute, async route => {
    if (route.request().url().includes('/history?')) {
      const url = new URL(route.request().url())
      historyRange = { start: url.searchParams.get('start'), end: url.searchParams.get('end') }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
        start: historyRange.start, end: historyRange.end, bucket: url.searchParams.get('bucket'),
        total: { ...current, signals: 0, commands: 0, data_requests: 0, wakes: 0, estimated_usd: 0 },
        points: [],
      }) })
    } else {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(cycle) })
    }
  })
  await page.goto('/tesla-api-usage')
  await page.getByRole('button', { name: 'Date range' }).click()
  const picker = page.getByRole('dialog', { name: 'Date range picker' })
  await picker.getByRole('button', { name: 'New range' }).click()
  const september = picker.getByRole('grid', { name: 'September' })
  await expect(september.getByRole('gridcell', { name: '20' })).toBeVisible()
  await september.getByRole('gridcell', { name: '20' }).click()
  await september.getByRole('gridcell', { name: '21' }).click()
  await picker.getByRole('button', { name: 'Apply' }).click()
  await expect.poll(() => historyRange).toEqual({
    start: '2026-09-20T00:00:00.000Z', end: '2026-09-22T00:00:00.000Z',
  })
  await expect(page.locator('figure').filter({ hasText: 'Tesla usage cost over time' })).toHaveAttribute('data-chart-state', 'empty')
})
