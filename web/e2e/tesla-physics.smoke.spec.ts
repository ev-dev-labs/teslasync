import { expect, test } from '@playwright/test'
import { installApiMocks, seedBrowserState } from './mockApi'

if (process.env.TESLASYNC_BROWSER_PATH) {
  test.use({ launchOptions: { executablePath: process.env.TESLASYNC_BROWSER_PATH } })
}

const start = '2026-03-01T11:00:00Z'
const end = '2026-03-01T12:00:00Z'
const report = {
  vehicle_id: 7,
  evidence: {
    requested_from: start, requested_to: end, first_recorded_at: start, last_recorded_at: end,
    history_rows: 2, black_box_rows: 0, history_truncated: true, black_box_truncated: false,
    drive_sessions_truncated: false, charge_sessions_truncated: false,
    history_available: true, black_box_available: false,
  },
  clocks: {
    vehicle_id: 7, latest: { event_time: end, ingest_time: null, display_time: end, gap_s: 600, unknown: true },
    samples: [
      { event_time: start, ingest_time: null, display_time: end, gap_s: 60, unknown: false },
      { event_time: end, ingest_time: null, display_time: end, gap_s: 600, unknown: true },
    ],
    honesty: 'Only returned readings are represented.',
  },
  charge_port_court: {
    vehicle_id: 7,
    evidence: [
      { at: start, gear: 'P', firmware: '2026.20.3', latch: 'Engaged', charge_state: 'Complete', scheduled_mode: 'OffPeak', door_open: true, pack_current_a: 12.5 },
      { at: end, gear: 'P', firmware: '2026.20.3', latch: 'Released', charge_state: 'Disconnected', scheduled_mode: 'OffPeak', door_open: true, pack_current_a: null },
    ],
    honesty: 'Complete is not unplugged.',
  },
}

test('Tesla Physics workbench preserves deep links, evidence and mobile/desktop navigation in both themes', async ({ page }, testInfo) => {
  testInfo.setTimeout(180_000)
  for (const theme of ['dark', 'light'] as const) {
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 })
      await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' })
      await seedBrowserState(page, theme, '/tesla-physics/clocks')
      await installApiMocks(page, 'populated', theme)
      await page.route(/\/api\/v1\/physics\/exclusive(?:\?|$)/, async (route) => {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(report) })
      })

      await page.goto('/tesla-physics/clocks')
      await expect(page.getByRole('heading', { name: 'Tesla Physics', exact: true })).toBeVisible()
      await expect(page.getByRole('heading', { name: 'Three Clocks' })).toBeVisible()
      if (width === 390) {
        await expect(page.getByRole('combobox', { name: 'Choose investigation' })).toHaveValue('clocks')
      } else {
        await expect(page.getByRole('link', { name: 'Three Clocks' })).toHaveAttribute('aria-current', 'page')
        await expect(page.getByRole('heading', { name: 'Time & coverage' })).toBeVisible()
      }
      await expect(page.getByText('History row cap reached')).toBeVisible()
      await expect(page.getByText('Stored ingest timestamps: 0 / 2')).toBeVisible()
      await page.screenshot({ path: testInfo.outputPath(`physics-clocks-${theme}-${width}.png`), fullPage: true })

      await page.getByRole('button', { name: 'Inspect raw evidence: Three Clocks (2 rows)' }).click()
      await expect(page.getByText('Showing 1–2 of 2').last()).toBeVisible()
      await page.screenshot({ path: testInfo.outputPath(`physics-clocks-evidence-${theme}-${width}.png`), fullPage: true })

      if (width === 390) {
        await page.getByRole('combobox', { name: 'Choose investigation' }).selectOption('charge-port')
      } else {
        await page.getByRole('link', { name: 'Charge-Port Court' }).click()
      }
      await expect(page).toHaveURL(/\/tesla-physics\/charge-port$/)
      await expect(page.getByRole('heading', { name: 'Charge-Port Court' })).toBeVisible()
      if (width === 390) {
        await expect(page.getByRole('combobox', { name: 'Choose investigation' })).toHaveValue('charge-port')
      } else {
        await expect(page.getByRole('link', { name: 'Charge-Port Court' })).toHaveAttribute('aria-current', 'page')
      }
      await page.getByRole('combobox', { name: 'Filter charge-port samples by state' }).selectOption('Complete')
      await page.getByRole('button', { name: 'Inspect raw evidence: Charge-Port Court (1 rows)' }).click()
      await expect(page.getByText('Showing 1–1 of 1')).toBeVisible()
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
      await page.screenshot({ path: testInfo.outputPath(`physics-charge-port-${theme}-${width}.png`), fullPage: true })
      await page.unroute(/\/api\/v1\/physics\/exclusive(?:\?|$)/)
      await page.unroute('**/api/**')
    }
  }
})
