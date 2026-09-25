import { expect, test } from '@playwright/test'
import { installApiMocks, seedBrowserState } from './mockApi'

for (const width of [390, 1440]) {
  test(`Automation search and status remain usable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await seedBrowserState(page, 'light', '/automations')
    await installApiMocks(page)
    await page.goto('/automations', { waitUntil: 'domcontentloaded' })

    const search = page.getByRole('textbox', { name: 'Search automations...' })
    const status = page.getByRole('combobox', { name: 'Filter by status' })
    await expect(search).toBeVisible()
    await expect(status).toBeVisible()
    const searchBox = await search.boundingBox()
    const statusBox = await status.boundingBox()
    expect(searchBox).not.toBeNull()
    expect(statusBox).not.toBeNull()
    if (width === 390) {
      expect(searchBox!.width).toBeGreaterThan(250)
      expect(searchBox!.y).toBeGreaterThan(statusBox!.y)
    } else {
      expect(searchBox!.width).toBeGreaterThan(statusBox!.width)
      expect(Math.abs(searchBox!.y - statusBox!.y)).toBeLessThan(4)
    }
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  })

  test(`Automation builder keeps guided actions and geofence setup readable at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    await seedBrowserState(page, 'light', '/automations/new')
    await installApiMocks(page)
    await page.goto('/automations/new', { waitUntil: 'domcontentloaded' })

    await expect(page.getByRole('combobox', { name: 'Action Type' })).toBeVisible()
    await expect(page.getByRole('combobox', { name: 'Command' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Advanced parameters (JSON)' })).toBeVisible()
    await expect(page.getByLabel('Params (JSON, optional)')).toHaveCount(0)

    await page.getByRole('combobox', { name: 'Trigger Type' }).selectOption('trigger_geofence')
    await expect(page.getByRole('link', { name: 'Manage places' })).toBeVisible()
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)

    const screenshot = testInfo.outputPath('automation-builder.png')
    await page.screenshot({ path: screenshot, fullPage: true })
    await testInfo.attach('automation-builder', { path: screenshot, contentType: 'image/png' })
    const actionScreenshot = testInfo.outputPath('automation-actions.png')
    await page.locator('[data-tour="automation-actions"]').screenshot({ path: actionScreenshot })
    await testInfo.attach('automation-actions', { path: actionScreenshot, contentType: 'image/png' })
  })
}
