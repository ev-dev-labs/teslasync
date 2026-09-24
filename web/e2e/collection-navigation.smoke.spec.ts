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
      await page.goto('/driving-dynamics', { waitUntil: 'domcontentloaded' })
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

  test(`shows ${style} Commands as a two-level ladder without a duplicate`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 900 })
    await page.emulateMedia({ colorScheme: 'light' })
    await seedBrowserState(page, 'light', '/commands')
    await page.addInitScript(selectedStyle => {
      localStorage.setItem('teslasync:sidebar-style:v1', selectedStyle)
    }, style)
    const mockApi = await installApiMocks(page)
    await page.goto('/commands', { waitUntil: 'domcontentloaded' })
    await waitForHarnessReady(page, mockApi)
    await openSidebarOnMobile(page, 390)

    const sidebar = page.getByRole('navigation', { name: style === 'legacy' ? 'Navigation sections' : 'Sidebar navigation' })
    const collection = sidebar.locator('[data-collection="/commands"]')
    if (style === 'linear') {
      await expect(collection.getByRole('button', { name: 'Commands, 3 views' })).toHaveAttribute('aria-expanded', 'true')
    } else {
      await expect(collection.getByRole('button', { name: 'Commands, 3 views' })).toHaveCount(0)
    }
    await expect(collection.getByRole('link', { name: 'Send Commands' })).toHaveAttribute('aria-current', 'page')
    await expect(collection.getByRole('link', { name: 'Command History' })).toBeVisible()
    await collection.getByRole('link', { name: 'Command Reliability' }).scrollIntoViewIfNeeded()
    const screenshotPath = testInfo.outputPath('commands-ladder.png')
    await page.screenshot({ path: screenshotPath })
    await testInfo.attach('commands-ladder', { path: screenshotPath, contentType: 'image/png' })
    await collection.getByRole('link', { name: 'Command Reliability' }).click()
    await expect(page).toHaveURL(/\/command-reliability$/)
  })
}

test('distinguishes Charging Activity from its Charging section', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.emulateMedia({ colorScheme: 'light' })
  await seedBrowserState(page, 'light', '/charging')
  await page.addInitScript(() => {
    localStorage.setItem('teslasync:sidebar-style:v1', 'legacy')
  })
  const mockApi = await installApiMocks(page)
  await page.goto('/charging', { waitUntil: 'domcontentloaded' })
  await waitForHarnessReady(page, mockApi)
  const sidebar = page.getByRole('navigation', { name: 'Navigation sections' })
  const collection = sidebar.locator('[data-collection="/charging"]')
  await expect(collection.getByRole('button', { name: 'Charging Activity, 6 views' })).toHaveAttribute('aria-expanded', 'true')
  await expect(collection.getByRole('link', { name: 'Charging Overview' })).toHaveAttribute('aria-current', 'page')
  await collection.getByRole('link', { name: 'Charging Overview' }).scrollIntoViewIfNeeded()
  const screenshotPath = testInfo.outputPath('charging-ladder.png')
  await page.screenshot({ path: screenshotPath })
  await testInfo.attach('charging-ladder', { path: screenshotPath, contentType: 'image/png' })
})
