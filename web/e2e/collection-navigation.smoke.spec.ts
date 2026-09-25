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
      const collectionButton = collection.getByRole('button', { name: 'Driving Performance, 7 views' })
      await expect(collectionButton).toHaveAttribute('aria-expanded', 'true')
      await expect(collectionButton).not.toContainText('views')
      await expect(collectionButton.locator('span[aria-hidden="true"]')).toHaveText('7')
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
      await expect(collection.getByRole('button', { name: 'Command Center, 3 views' })).toHaveAttribute('aria-expanded', 'true')
    } else {
      await expect(collection.getByRole('button', { name: 'Command Center, 3 views' })).toHaveCount(0)
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
  await expect(sidebar.getByRole('link', { name: 'Charging Overview' })).toHaveCount(1)
  await expect(sidebar.getByRole('link', { name: 'Charging Overview' })).toHaveAttribute('aria-current', 'page')
  await expect(collection.getByRole('link').first()).toHaveAttribute('href', '/charging')
  await collection.getByRole('link', { name: 'Charge History' }).scrollIntoViewIfNeeded()
  const screenshotPath = testInfo.outputPath('charging-ladder.png')
  await page.screenshot({ path: screenshotPath })
  await testInfo.attach('charging-ladder', { path: screenshotPath, contentType: 'image/png' })
})

test('resizes the desktop sidebar without clipping long section names and restores its width', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await seedBrowserState(page, 'light', '/charging')
  await page.addInitScript(() => {
    localStorage.setItem('teslasync:sidebar-style:v1', 'notion')
  })
  const mockApi = await installApiMocks(page)
  await page.goto('/charging', { waitUntil: 'domcontentloaded' })
  await waitForHarnessReady(page, mockApi)

  const sidebar = page.locator('[data-role="sidebar"]')
  const handle = page.getByRole('separator', { name: 'Resize sidebar' })
  await expect(handle).toBeVisible()
  const bounds = await handle.boundingBox()
  if (!bounds) throw new Error('Sidebar resize handle has no bounds')
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + 100)
  await page.mouse.down()
  await page.mouse.move(bounds.x + bounds.width / 2 + 115, bounds.y + 100, { steps: 6 })
  await page.mouse.up()
  await expect.poll(async () => Number(await handle.getAttribute('aria-valuenow'))).toBeGreaterThanOrEqual(380)
  const resizedWidth = await handle.getAttribute('aria-valuenow')
  if (!resizedWidth) throw new Error('Sidebar width was not reported')
  await expect(sidebar).toHaveCSS('width', `${resizedWidth}px`)
  await expect.poll(() => page.evaluate(() => localStorage.getItem('teslasync-sidebar-width'))).toBe(resizedWidth)

  const section = page.getByRole('button', { name: /Advanced Intelligence/ }).first()
  await section.scrollIntoViewIfNeeded()
  await expect(section).toBeVisible()
  const sectionLabel = section.locator('span').filter({ hasText: 'Advanced Intelligence' }).last()
  await expect.poll(() => sectionLabel.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
  const screenshotPath = testInfo.outputPath('resized-sidebar.png')
  await page.screenshot({ path: screenshotPath })
  await testInfo.attach('resized-sidebar', { path: screenshotPath, contentType: 'image/png' })

  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('separator', { name: 'Resize sidebar' })).toHaveAttribute('aria-valuenow', resizedWidth)
})
