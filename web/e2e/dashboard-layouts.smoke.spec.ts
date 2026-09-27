import { expect, test } from '@playwright/test'
import { expectThemeApplied, installApiMocks, seedBrowserState, waitForHarnessReady } from './mockApi'

for (const theme of ['dark', 'light'] as const) {
  for (const width of [390, 1440]) {
    test(`layout packs stay readable and blank dashboards survive reload at ${width}px in ${theme} mode`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 900 })
      await seedBrowserState(page, theme, '/')
      const mockApi = await installApiMocks(page, 'populated', theme)
      await page.goto('/', { waitUntil: 'domcontentloaded' })
      await waitForHarnessReady(page, mockApi)
      await expectThemeApplied(page, theme)

      await page.getByRole('button', { name: 'Layout packs' }).first().click()
      const gallery = page.getByRole('dialog', { name: 'Layout packs' })
      await expect(gallery).toBeVisible()
      await expect(gallery.getByRole('heading', { name: 'Default' })).toBeVisible()
      const preview = gallery.getByTestId('mini-grid-preview').first()
      await expect(preview).toBeVisible()
      expect((await preview.boundingBox())?.height).toBeLessThan(200)
      expect((await gallery.boundingBox())?.height).toBeLessThanOrEqual(900)
      await page.screenshot({ path: testInfo.outputPath(`layout-packs-${width}-${theme}.png`), animations: 'disabled' })

      await gallery.getByRole('button', { name: /Blank Dashboard/ }).click()
      await expect(gallery).toHaveCount(0)
      await expect(page.getByText('No widgets yet')).toBeVisible()
      await page.getByRole('button', { name: 'Actions for New Dashboard' }).click()
      const actions = page.getByRole('menu', { name: 'Actions for New Dashboard' })
      await expect(actions).toBeVisible()
      const background = await actions.evaluate((menu) => getComputedStyle(menu).backgroundColor)
      expect(background).toMatch(/^rgb\(\d+, \d+, \d+\)$/)
      await page.screenshot({ path: testInfo.outputPath(`layout-actions-${width}-${theme}.png`), animations: 'disabled' })
      await page.keyboard.press('Escape')
      const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('teslasync-dashboards') ?? '[]'))
      expect(saved.at(-1)?.widgets).toEqual([])

      // The shared browser seed is re-applied on every reload. A new tab has
      // the same storage but no seeding script, so it exercises real hydration.
      const restoredPage = await page.context().newPage()
      await installApiMocks(restoredPage, 'populated', theme)
      await restoredPage.goto('/', { waitUntil: 'domcontentloaded' })
      await expect(restoredPage.getByText('No widgets yet')).toBeVisible()
      await restoredPage.reload({ waitUntil: 'domcontentloaded' })
      await expect(restoredPage.getByText('No widgets yet')).toBeVisible()
      await restoredPage.close()
    })
  }
}

test('installs a layout pack and restores its widgets in a new browser', async ({ page, browser }) => {
  await seedBrowserState(page, 'dark', '/')
  await installApiMocks(page)
  await page.goto('/', { waitUntil: 'domcontentloaded' })

  await page.getByRole('button', { name: 'Layout packs' }).first().click()
  const gallery = page.getByRole('dialog', { name: 'Layout packs' })
  await gallery.getByRole('button', { name: /Daily Commuter/ }).click()
  await page.getByRole('dialog', { name: 'Template Preview' })
    .getByRole('button', { name: 'Install as new dashboard' }).click()
  await expect(page.getByRole('button', { name: 'Switch dashboard layout' })).toContainText('Daily Commuter')

  const saved = await page.evaluate(() => ({
    dashboards: JSON.parse(localStorage.getItem('teslasync-dashboards') ?? '[]') as unknown[],
    active_id: localStorage.getItem('teslasync-active-dashboard') ?? '',
  }))
  const context = await browser.newContext()
  try {
    const restored = await context.newPage()
    await restored.addInitScript(() => {
      localStorage.setItem('teslasync-onboarded', 'true')
      localStorage.setItem('teslasync:onboarding:skipped:v1', '1')
    })

    await installApiMocks(restored)
    await restored.route('**/api/v1/settings/dashboard-layouts', (route) => {
      if (route.request().method() === 'GET') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(saved),
        })
      }
      return route.fallback()
    })
    await restored.goto(page.url(), { waitUntil: 'domcontentloaded' })
    await expect(restored.getByRole('button', { name: 'Switch dashboard layout' })).toContainText('Daily Commuter')
    const hydrated = await restored.evaluate(() =>
      JSON.parse(localStorage.getItem('teslasync-dashboards') ?? '[]') as Array<{ id: string; widgets: unknown[] }>,
    )
    expect(hydrated.find((dashboard) => dashboard.id === saved.active_id)?.widgets).toHaveLength(7)
  } finally {
    await context.close()
  }
})

for (const width of [390, 1440]) {
  test(`new dashboards show fleet posture in the ${width}px widget grid without a fixed brief`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    await page.addInitScript(() => {
      localStorage.setItem('teslasync-onboarded', 'true')
      localStorage.setItem('teslasync:onboarding:skipped:v1', '1')
      localStorage.setItem('teslasync:changelog:seen-version', '99.0.0')
      localStorage.setItem('teslasync:changelog:last-shown', '1787760000000')
    })
    const mockApi = await installApiMocks(page)
    await page.goto('/', { waitUntil: 'domcontentloaded' })
    await waitForHarnessReady(page, mockApi)

    const grid = page.getByRole('region', { name: 'Dashboard widgets' })
    const posture = grid.getByTestId('fleet-operations-brief')
    await expect(posture).toBeVisible()
    await expect(grid.getByTestId('fleet-posture-taxonomy')).toBeVisible()
    await posture.screenshot({
      path: testInfo.outputPath(`fleet-posture-widget-${width}.png`),
      animations: 'disabled',
    })
    await expect(page.getByText('Operational brief')).toHaveCount(0)
    await expect(page.getByRole('navigation', { name: 'Primary workflows' })).toHaveCount(0)
    await expect(page.getByText('Recommended actions')).toHaveCount(0)
  })
}
