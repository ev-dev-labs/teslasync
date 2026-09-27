import { expect, test } from '@playwright/test'
import {
  fulfillApiMock,
  installApiMocks,
  resolveApiFixture,
  seedBrowserState,
  waitForHarnessReady,
} from './mockApi'

for (const theme of ['light', 'dark'] as const) {
  for (const width of [390, 1440]) {
    test(`view settings respond to range and density at ${width}px in ${theme} mode`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 900 })
      await seedBrowserState(page, theme, '/drives')
      const mockApi = await installApiMocks(page, 'populated', theme)
      const initial = resolveApiFixture('/settings', 'GET', 'populated', theme)
      if (!initial.matched || !initial.body || typeof initial.body !== 'object') {
        throw new Error('Settings fixture is unavailable')
      }

      let settings = initial.body as Record<string, unknown>
      await page.route('**/api/v1/settings', async route => {
        if (route.request().method() === 'PUT') {
          const payload: unknown = route.request().postDataJSON()
          if (!payload || typeof payload !== 'object') throw new Error('Expected settings payload')
          settings = payload as Record<string, unknown>
        }
        await fulfillApiMock(route, mockApi, { status: 200, json: settings })
      })
      await page.goto('/drives', { waitUntil: 'domcontentloaded' })
      await waitForHarnessReady(page, mockApi)
      if (width < 1280) await page.getByRole('button', { name: 'Open sidebar' }).click()

      await page.getByRole('button', { name: /Analysis window: Last 7 days/ }).click()
      const dialog = page.getByRole('dialog', { name: 'View settings' })
      await expect(dialog).toBeVisible()
      await expect(dialog.getByRole('button', { name: '7 days' })).toHaveAttribute('aria-pressed', 'true')
      await expect(dialog.getByRole('button', { name: 'Last 5 min' })).toHaveCount(0)
      await expect(dialog.getByLabel('Start date')).toHaveCount(0)
      await dialog.getByRole('button', { name: 'Last 24 hours' }).click()
      await expect(dialog.getByRole('button', { name: 'Last 24 hours' })).toHaveAttribute('aria-pressed', 'true')
      await expect(dialog.getByText(/Rolling window:/)).toBeVisible()

      const screenshotPath = testInfo.outputPath(`view-settings-${theme}-${width}.png`)
      await dialog.screenshot({ path: screenshotPath })
      await testInfo.attach('view-settings', { path: screenshotPath, contentType: 'image/png' })

      await dialog.getByRole('button', { name: 'Compact' }).click()
      await expect(dialog.getByRole('button', { name: 'Compact' })).toHaveAttribute('aria-pressed', 'true')
      await expect.poll(() => page.evaluate(() => document.body.dataset.density)).toBe('compact')
      await dialog.getByRole('button', { name: 'Custom' }).click()
      await expect(dialog.getByLabel('Start date')).toBeVisible()
      await expect(dialog.getByLabel('End date')).toBeVisible()
      await dialog.getByRole('button', { name: '30 days' }).click()
      await expect(dialog.getByLabel('Start date')).toHaveCount(0)
    })
  }
}

test('Drive Calendar year selection stays fixed when its range reaches another screen', async ({ page }) => {
  await seedBrowserState(page, 'light', '/drive-calendar')
  const mockApi = await installApiMocks(page, 'populated', 'light')
  await page.goto('/drive-calendar', { waitUntil: 'domcontentloaded' })
  await waitForHarnessReady(page, mockApi)

  await page.getByRole('button', { name: /Analysis window:/ }).click()
  const calendarSettings = page.getByRole('dialog', { name: 'View settings' })
  await expect(calendarSettings.getByRole('button', { name: '1 year' })).toBeVisible()
  await calendarSettings.getByLabel('Calendar year').fill('2024')
  await calendarSettings.getByRole('button', { name: 'Show year' }).click()
  await expect.poll(() => new URL(page.url()).searchParams.get('from')).toBe('2024-01-01')
  await expect.poll(() => new URL(page.url()).searchParams.get('to')).toBe('2024-12-31')
  expect(new URL(page.url()).searchParams.get('time_scope')).toBe('custom')

  const selected = new URL(page.url()).search
  await page.goto(`/drives${selected}`, { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: /Analysis window: Custom/ }).click()
  const drivesSettings = page.getByRole('dialog', { name: 'View settings' })
  await expect(drivesSettings.getByRole('button', { name: '1 year' })).toHaveCount(0)
  await expect(drivesSettings.getByLabel('Calendar year')).toHaveCount(0)
  expect(new URL(page.url()).searchParams.get('from')).toBe('2024-01-01')
  expect(new URL(page.url()).searchParams.get('to')).toBe('2024-12-31')
})
