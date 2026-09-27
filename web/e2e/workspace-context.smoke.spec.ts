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

for (const width of [390, 1440]) {
test(`Drive Calendar year chips shift and preserve fixed dates at ${width}px`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width, height: 900 })
  await seedBrowserState(page, 'light', '/drive-calendar')
  const mockApi = await installApiMocks(page, 'populated', 'light')
  await page.goto('/drive-calendar', { waitUntil: 'domcontentloaded' })
  await waitForHarnessReady(page, mockApi)

  if (width < 1280) await page.getByRole('button', { name: 'Open sidebar' }).click()
  await page.getByRole('button', { name: /Analysis window:/ }).click()
  const calendarSettings = page.getByRole('dialog', { name: 'View settings' })
  const currentYear = new Date().getFullYear()
  await expect(calendarSettings.getByRole('button', { name: 'Year to date' })).toBeVisible()
  await expect(calendarSettings.getByRole('button', { name: 'All time' })).toBeVisible()
  await expect(calendarSettings.getByLabel('Calendar year')).toHaveCount(0)
  await calendarSettings.screenshot({ path: testInfo.outputPath(`calendar-year-options-${width}.png`) })
  await calendarSettings.getByRole('button', { name: `Full year ${currentYear}` }).click()
  await expect.poll(() => new URL(page.url()).searchParams.get('to')).toBe(`${currentYear}-12-31`)
  await expect(calendarSettings.getByRole('button', { name: 'Next year' })).toBeDisabled()
  await calendarSettings.getByRole('button', { name: 'Previous year' }).click()
  await expect(calendarSettings.getByRole('button', { name: `Full year ${currentYear - 1}` })).toHaveAttribute('aria-pressed', 'true')
  await calendarSettings.getByRole('button', { name: 'Previous year' }).click()
  await expect(calendarSettings.getByRole('button', { name: `Full year ${currentYear - 2}` })).toHaveAttribute('aria-pressed', 'true')
  await calendarSettings.getByRole('button', { name: 'Next year' }).click()
  await expect(calendarSettings.getByRole('button', { name: `Full year ${currentYear - 1}` })).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(() => new URL(page.url()).searchParams.get('from')).toBe(`${currentYear - 1}-01-01`)
  await expect.poll(() => new URL(page.url()).searchParams.get('to')).toBe(`${currentYear - 1}-12-31`)
  expect(new URL(page.url()).searchParams.get('time_scope')).toBe('custom')

  const selected = new URL(page.url()).search
  await page.goto(`/drives${selected}`, { waitUntil: 'domcontentloaded' })
  if (width < 1280) await page.getByRole('button', { name: 'Open sidebar' }).click()
  await page.getByRole('button', { name: /Analysis window: Custom/ }).click()
  const drivesSettings = page.getByRole('dialog', { name: 'View settings' })
  await expect(drivesSettings.getByRole('button', { name: `Full year ${currentYear - 1}` })).toHaveCount(0)
  await expect(drivesSettings.getByLabel('Calendar year')).toHaveCount(0)
  expect(new URL(page.url()).searchParams.get('from')).toBe(`${currentYear - 1}-01-01`)
  expect(new URL(page.url()).searchParams.get('to')).toBe(`${currentYear - 1}-12-31`)
})
}

for (const width of [390, 1440]) {
  test(`selected full year remains legible at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    await seedBrowserState(page, 'light', '/drive-calendar')
    const mockApi = await installApiMocks(page, 'populated', 'light')
    await page.goto('/drive-calendar?from=2017-01-01&to=2017-12-31&time_scope=custom', { waitUntil: 'domcontentloaded' })
    await waitForHarnessReady(page, mockApi)
    if (width < 1280) await page.getByRole('button', { name: 'Open sidebar' }).click()
    await page.getByRole('button', { name: 'Analysis window: Full year 2017' }).click()
    const dialog = page.getByRole('dialog', { name: 'View settings' })
    const selected = dialog.getByRole('button', { name: 'Full year 2017' })
    await expect(selected).toHaveAttribute('aria-pressed', 'true')
    await expect(selected).toContainText('2017')
    await expect(dialog.getByLabel('Start date')).toHaveCount(0)
    const label = await selected.locator('span').first().boundingBox()
    const year = await selected.locator('span').last().boundingBox()
    expect(label).not.toBeNull()
    expect(year).not.toBeNull()
    expect(year!.y).toBeGreaterThanOrEqual(label!.y + label!.height)
    await dialog.screenshot({ path: testInfo.outputPath(`selected-year-${width}.png`) })
  })
}
