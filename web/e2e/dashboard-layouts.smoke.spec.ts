import { expect, test } from '@playwright/test'
import { assertMockApiComplete, expectThemeApplied, fulfillApiMock, installApiMocks, seedBrowserState, waitForHarnessReady } from './mockApi'

for (const theme of ['dark', 'light'] as const) {
  for (const width of [390, 1440]) {
    test(`new layout gallery stays readable and blank dashboards survive reopening at ${width}px in ${theme} mode`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 900 })
      await seedBrowserState(page, theme, '/')
      const mockApi = await installApiMocks(page, 'populated', theme)
      await page.goto('/', { waitUntil: 'domcontentloaded' })
      await waitForHarnessReady(page, mockApi)
      await expectThemeApplied(page, theme)

      await page.getByRole('button', { name: 'Switch dashboard layout' }).click()
      await page.getByRole('menuitem', { name: 'New from template…' }).click()
      const gallery = page.getByRole('dialog', { name: 'Create a layout' })
      await expect(gallery).toBeVisible()
      await expect(gallery.getByRole('heading', { name: 'Default' })).toBeVisible()
      const preview = gallery.getByTestId('mini-grid-preview').first()
      await expect(preview).toBeVisible()
      expect((await preview.boundingBox())?.height).toBeLessThanOrEqual(260)
      expect((await gallery.boundingBox())?.height).toBeLessThanOrEqual(900)
      await page.screenshot({ path: testInfo.outputPath(`layout-packs-${width}-${theme}.png`), animations: 'disabled' })

      await gallery.getByRole('button', { name: /Blank dashboard/ }).click()
      await gallery.getByRole('button', { name: 'Create layout' }).click()
      await expect(gallery).toHaveCount(0)
      await expect(page.getByText('No widgets yet')).toBeVisible()
      await page.getByRole('button', { name: 'Switch dashboard layout' }).click()
      const actions = page.getByRole('menu', { name: 'Saved layouts' })
      await expect(actions).toBeVisible()
      const background = await actions.evaluate((menu) => getComputedStyle(menu).backgroundColor)
      expect(background).toMatch(/^rgba?\(\d+, \d+, \d+(?:, \d+(?:\.\d+)?)?\)$/)
      if (background.startsWith('rgba(')) {
        expect(Number(background.split(', ')[3].replace(')', ''))).toBeGreaterThanOrEqual(0.9)
      }
      await page.screenshot({ path: testInfo.outputPath(`layout-actions-${width}-${theme}.png`), animations: 'disabled' })
      await page.keyboard.press('Escape')
      const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('teslasync-dashboards') ?? '[]'))
      expect(saved.at(-1)?.widgets).toEqual([])
      await expect.poll(() => page.evaluate(() =>
        localStorage.getItem('teslasync-dashboard-pending-save'))).toBeNull()
      await waitForHarnessReady(page, mockApi)
      await assertMockApiComplete(page, mockApi)
      const browserContext = page.context()
      await page.close()

      const restoredPage = await browserContext.newPage()
      await seedBrowserState(restoredPage, theme, '/', { preserveDashboardState: true })
      const restoredMockApi = await installApiMocks(restoredPage, 'populated', theme)
      await restoredPage.goto('/', { waitUntil: 'domcontentloaded' })
      await expect(restoredPage.getByText('No widgets yet')).toBeVisible()
      await expect.poll(() => restoredMockApi?.seen.has('GET /settings/dashboard-layouts')).toBe(true)
      await waitForHarnessReady(restoredPage, restoredMockApi)
      await assertMockApiComplete(restoredPage, restoredMockApi)
      await restoredPage.close()
      const reopenedPage = await browserContext.newPage()
      await seedBrowserState(reopenedPage, theme, '/', { preserveDashboardState: true })
      const reopenedMockApi = await installApiMocks(reopenedPage, 'populated', theme)
      await reopenedPage.goto('/', { waitUntil: 'domcontentloaded' })
      await expect(reopenedPage.getByText('No widgets yet')).toBeVisible()
      await expect.poll(() => reopenedMockApi?.seen.has('GET /settings/dashboard-layouts')).toBe(true)
      await waitForHarnessReady(reopenedPage, reopenedMockApi)
      await assertMockApiComplete(reopenedPage, reopenedMockApi)
      await reopenedPage.close()
    })
  }
}

test('creates a populated layout and restores its widgets in a new browser', async ({ page, browser }) => {
  await seedBrowserState(page, 'dark', '/')
  const mockApi = await installApiMocks(page)
  await page.goto('/', { waitUntil: 'domcontentloaded' })

  await page.getByRole('button', { name: 'Switch dashboard layout' }).click()
  await page.getByRole('menuitem', { name: 'New from template…' }).click()
  const gallery = page.getByRole('dialog', { name: 'Create a layout' })
  await gallery.getByRole('button', { name: /Daily Commuter/ }).click()
  await gallery.getByRole('button', { name: 'Create layout' }).click()
  await expect(page.getByRole('button', { name: 'Switch dashboard layout' })).toContainText('Daily Commuter')

  const saved = await page.evaluate(() => ({
    dashboards: JSON.parse(localStorage.getItem('teslasync-dashboards') ?? '[]') as unknown[],
    active_id: localStorage.getItem('teslasync-active-dashboard') ?? '',
  }))
  await expect.poll(() => page.evaluate(() =>
    localStorage.getItem('teslasync-dashboard-pending-save'))).toBeNull()
  await waitForHarnessReady(page, mockApi)
  await assertMockApiComplete(page, mockApi)
  const context = await browser.newContext()
  try {
    const restored = await context.newPage()
    await seedBrowserState(restored, 'dark', '/', { preserveDashboardState: true })

    const restoredMockApi = await installApiMocks(restored)
    await restored.route('**/api/v1/settings/dashboard-layouts', (route) => {
      if (route.request().method() === 'GET') {
        return fulfillApiMock(route, restoredMockApi, {
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(saved),
        })
      }
      return route.fallback()
    })
    await restored.goto(page.url(), { waitUntil: 'domcontentloaded' })
    await expect(restored.getByRole('button', { name: 'Switch dashboard layout' })).toContainText('Daily Commuter')
    await waitForHarnessReady(restored, restoredMockApi)
    const hydrated = await restored.evaluate(() =>
      JSON.parse(localStorage.getItem('teslasync-dashboards') ?? '[]') as Array<{ id: string; widgets: unknown[] }>,
    )
    expect(hydrated.find((dashboard) => dashboard.id === saved.active_id)?.widgets).toHaveLength(7)
    await assertMockApiComplete(restored, restoredMockApi)
  } finally {
    await context.close()
  }
})

test('mobile New Layout creates populated Operations Desk without mixing templates into Add Widget', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await seedBrowserState(page, 'dark', '/')
  const mockApi = await installApiMocks(page)
  await page.route('**/api/v1/analytics/fleet?**', (route) =>
    fulfillApiMock(route, mockApi, {
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ total_vehicles: 0, total_drives: 0, total_distance_m: 0 }),
    }),
  )
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await waitForHarnessReady(page, mockApi)

  await page.getByRole('button', { name: 'Switch dashboard layout' }).click()
  await page.getByRole('menuitem', { name: 'New from template…' }).click()
  const gallery = page.getByRole('dialog', { name: 'Create a layout' })
  await expect(gallery.getByRole('button', { name: /Blank dashboard/ })).toBeVisible()
  await gallery.getByRole('button', { name: /Operations Desk/ }).click()
  await expect(gallery).toContainText('Fleet Posture')
  await gallery.getByRole('button', { name: 'Create layout' }).click()
  await expect(page.getByRole('button', { name: 'Switch dashboard layout' })).toContainText('Operations Desk')
  const widgets = await page.evaluate(() => {
    const dashboards = JSON.parse(localStorage.getItem('teslasync-dashboards') ?? '[]') as
      Array<{ id: string; widgets: Array<{ widgetId: string }>; layouts: Record<string, unknown[]> }>
    return dashboards.find((d) => d.id === localStorage.getItem('teslasync-active-dashboard'))
  })
  expect(widgets?.widgets.map((widget) => widget.widgetId)).toContain('fleet-posture')
  expect(widgets?.layouts.xs).toHaveLength(widgets?.widgets.length)

  await page.getByRole('button', { name: 'Customize' }).click()
  await page.getByRole('button', { name: 'Add Widget' }).first().click()
  const picker = page.getByRole('complementary', { name: 'Add Widget' })
  await expect(picker.getByText('Layout Presets')).toHaveCount(0)
  await expect(picker.getByRole('textbox', { name: 'Search widgets' })).toBeVisible()
  await waitForHarnessReady(page, mockApi)
  await assertMockApiComplete(page, mockApi)
})

for (const width of [390, 1440]) {
  test(`new dashboards show fleet posture in the ${width}px widget grid without a fixed brief`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    await seedBrowserState(page, 'dark', '/', { preserveDashboardState: true })
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
    await assertMockApiComplete(page, mockApi)
  })
}
