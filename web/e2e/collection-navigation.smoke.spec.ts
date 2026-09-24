import { expect, test, type Page } from '@playwright/test'
import { installApiMocks, seedBrowserState, waitForHarnessReady } from './mockApi'

async function openSidebarOnMobile(page: Page, width: number) {
  if (width < 1280) await page.getByRole('button', { name: 'Open sidebar' }).click()
}

for (const style of ['linear', 'notion', 'legacy'] as const) {
  for (const width of [390, 1440]) {
    test(`switches directly between ${style} collection views at ${width}px`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 900 })
      await seedBrowserState(page, style === 'notion' ? 'light' : 'dark', '/driving-dynamics')
      await page.addInitScript(selectedStyle => {
        localStorage.setItem('teslasync:sidebar-style:v1', selectedStyle)
      }, style)
      const mockApi = await installApiMocks(page)
      await page.goto('/driving-dynamics')
      await waitForHarnessReady(page, mockApi)

      await openSidebarOnMobile(page, width)
      const sidebar = page.getByRole('navigation', { name: style === 'legacy' ? 'Navigation sections' : 'Sidebar navigation' })
      const collection = sidebar.locator('[data-collection="/driving-dynamics"]')
      await expect(collection.getByRole('button', { name: 'Driving Dynamics, 7 views' })).toHaveAttribute('aria-expanded', 'true')
      await expect(collection.getByRole('link', { name: 'Drive DNA' })).toBeVisible()
      await collection.getByRole('link', { name: 'Drive DNA' }).scrollIntoViewIfNeeded()
      const screenshotPath = testInfo.outputPath('collection-expanded.png')
      await page.screenshot({ path: screenshotPath })
      await testInfo.attach('collection-expanded', { path: screenshotPath, contentType: 'image/png' })
      await collection.getByRole('link', { name: 'Drive DNA' }).click()
      await expect(page).toHaveURL(/\/drive-dna$/)

      await openSidebarOnMobile(page, width)
      await expect(collection.getByRole('link', { name: 'Drive DNA' })).toHaveAttribute('aria-current', 'page')
      await collection.getByRole('link', { name: 'Regen Braking' }).click()
      await expect(page).toHaveURL(/\/regen-efficiency$/)
      await openSidebarOnMobile(page, width)
      await expect(collection.getByRole('link', { name: 'Regen Braking' })).toHaveAttribute('aria-current', 'page')
      await expect(page.locator('#main-content nav[aria-label*="sections"]')).toHaveCount(0)
    })
  }
}
