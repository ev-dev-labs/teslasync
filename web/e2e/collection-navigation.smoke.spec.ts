import { expect, test, type Page, type TestInfo } from '@playwright/test'
import { expectThemeApplied, installApiMocks, seedBrowserState, waitForHarnessReady } from './mockApi'

async function openSidebarOnMobile(page: Page, width: number) {
  if (width < 1280) await page.getByRole('button', { name: 'Open sidebar' }).click()
}

async function captureDeck(page: Page, testInfo: TestInfo, name: string) {
  const path = testInfo.outputPath(`${name}.png`)
  await page.screenshot({ path, animations: 'disabled' })
  await testInfo.attach(name, { path, contentType: 'image/png' })
}


for (const width of [390, 1440]) {
  test(`drives the command deck at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    await seedBrowserState(page, 'dark', '/driving-dynamics')
    const mockApi = await installApiMocks(page)
    await page.goto('/driving-dynamics', { waitUntil: 'domcontentloaded' })
    await waitForHarnessReady(page, mockApi)
    await expectThemeApplied(page, 'dark')
    await openSidebarOnMobile(page, width)

    const sidebar = page.locator('[data-role="sidebar"]')
    const nav = page.getByRole('navigation', { name: 'Sidebar navigation' })
    const rail = page.getByRole('navigation', { name: 'Sections and shortcuts' })
    if (width >= 1280) {
      // Section rail with hub shortcuts; the secondary panel starts closed.
      await expect(rail.getByRole('button', { name: 'Search' })).toBeVisible()
      await expect(rail.getByRole('button', { name: /Driving, \d+ pages/ })).toBeVisible()
      await expect(rail.getByRole('link', { name: 'Cars' })).toHaveCount(0)
      await expect(rail.getByRole('link', { name: 'Display' })).toContainText('Display')
      await expect(rail.getByRole('button', { name: 'Collapse sidebar' })).toHaveText('Collapse')
      await expect(page.getByTestId('command-deck-secondary')).toHaveCount(0)
      await captureDeck(page, testInfo, 'deck-rail')

      await rail.getByRole('button', { name: /Vehicles, \d+ pages/ }).click()
      await expect(nav.getByRole('link', { name: /My Vehicles/ })).toBeVisible()

      // Search: filter the whole catalog, follow a hit, panel stays open.
      await rail.getByRole('button', { name: 'Search' }).click()
      await sidebar.getByRole('combobox', { name: 'Search pages' }).fill('Drive DNA')
      await expect(nav.getByText('1 results')).toBeVisible()
      const hit = nav.getByRole('link', { name: /Drive DNA/ })
      await expect(hit).toBeVisible()
      await captureDeck(page, testInfo, 'deck-search')
      await hit.click()
      await expect(page).toHaveURL(/\/drive-dna$/)
      await expect(page.getByTestId('command-deck-secondary')).toHaveCount(1)

      // Section group: the docked panel is collapsible from either column.
      await rail.getByRole('button', { name: /Driving, \d+ pages/ }).click()
      await expect(nav.getByRole('button', { name: 'Driving Performance' })).toHaveAttribute('aria-expanded', 'true')
      await expect(nav.getByRole('button', { name: 'Drive Records' })).toHaveAttribute('aria-expanded', 'false')
      await nav.getByRole('button', { name: 'Expand all groups' }).click()
      await expect(nav.getByRole('link', { name: 'Regen Braking' })).toBeVisible()
      await expect(nav.getByText('Driving Performance')).toBeVisible()
      await nav.getByRole('button', { name: 'Collapse all groups' }).click()
      await expect(nav.getByRole('link', { name: 'Regen Braking' })).toHaveCount(0)
      await nav.getByRole('button', { name: 'Expand all groups' }).click()
      await expect(nav.getByRole('link', { name: 'Regen Braking' })).toBeVisible()
      await nav.getByRole('button', { name: 'Driving Performance' }).click()
      await expect(nav.getByRole('link', { name: 'Regen Braking' })).toHaveCount(0)
      await nav.getByRole('button', { name: 'Driving Performance' }).click()
      await expect(nav.getByRole('link', { name: 'Regen Braking' })).toBeVisible()
      // Docked, not floating: the aside widens to rail + panel.
      await expect(sidebar).toHaveCSS('width', '560px')
      await captureDeck(page, testInfo, 'deck-section')
      await nav.getByRole('link', { name: 'Drive DNA' }).dblclick()
      await expect(nav.getByRole('button', { name: 'Unpin Drive DNA' })).toBeVisible()
      const regen = nav.getByRole('link', { name: 'Regen Braking' })
      const pinRegen = nav.getByRole('button', { name: 'Pin Regen Braking to favorites' })
      await pinRegen.click()
      await expect(regen).toBeVisible()
      await expect(nav.getByRole('button', { name: 'Unpin Regen Braking' })).toBeVisible()
      await rail.getByRole('button', { name: 'Saved' }).click()
      await expect(nav.getByRole('link', { name: 'Regen Braking' })).toBeVisible()
      await rail.getByRole('button', { name: /Driving, \d+ pages/ }).click()
      await expect(nav.getByRole('button', { name: 'Driving Performance' })).toHaveAttribute('aria-expanded', 'true')
      await nav.getByRole('button', { name: 'Expand all groups' }).click()
      await expect(nav.getByRole('link', { name: 'Regen Braking' })).toBeVisible()
      await rail.getByRole('button', { name: /Driving, \d+ pages/ }).click()
      await expect(page.getByTestId('command-deck-secondary')).toHaveCount(0)
      await rail.getByRole('button', { name: /Driving, \d+ pages/ }).click()
      await expect(page.getByTestId('command-deck-secondary')).toHaveCount(1)
      await rail.getByRole('button', { name: /Diagnostics, \d+ pages/ }).click()
      const vehicleCosts = nav.getByRole('button', { name: 'Vehicle Costs' })
      await expect(vehicleCosts).toHaveAttribute('aria-expanded', 'false')
      await vehicleCosts.click()
      await expect(nav.getByRole('link', { name: 'Vehicle Cost' })).toBeVisible()
      await vehicleCosts.click()
      await expect(nav.getByRole('link', { name: 'Vehicle Cost' })).toHaveCount(0)
      await vehicleCosts.click()
      await expect(nav.getByRole('link', { name: 'Vehicle Cost' })).toBeVisible()

      // Suggested carries reason lines; Escape no longer closes the panel.
      await rail.getByRole('button', { name: 'Suggested' }).click()
      await expect(nav.getByText(/Related to /)).toHaveCount(4)
      await page.keyboard.press('Escape')
      await expect(page.getByTestId('command-deck-secondary')).toHaveCount(1)

      // Saved lists pins; collapsing the column keeps its links available.
      await rail.getByRole('button', { name: 'Saved' }).click()
      await expect(nav.getByRole('link', { name: 'My Vehicles' })).toBeVisible()
      await nav.getByRole('button', { name: 'Collapse secondary navigation' }).click()
      await expect(sidebar).toHaveCSS('width', '152px')
      await expect(rail.getByRole('button', { name: 'Expand sidebar' })).toBeVisible()
      await expect(nav.getByRole('link', { name: 'My Vehicles' })).toBeVisible()
      await nav.getByRole('link', { name: 'My Vehicles' }).hover()
      await expect(page.getByTestId('atlas-tip')).toContainText('My Vehicles')
      await captureDeck(page, testInfo, 'deck-compact-secondary-hover')
      await nav.getByRole('button', { name: 'Expand secondary navigation' }).click()
      await expect(sidebar).toHaveCSS('width', '396px')
      await nav.getByRole('button', { name: 'Close panel' }).click()
      await expect(page.getByTestId('command-deck-secondary')).toHaveCount(0)
      await expect(sidebar).toHaveCSS('width', '76px')

      // Rail collapses to icons-only and back, shrinking the aside.
      await rail.getByRole('button', { name: 'Expand sidebar' }).click()
      await expect(sidebar).toHaveCSS('width', '240px')
      await rail.getByRole('button', { name: 'Collapse sidebar' }).click()
      await expect(sidebar).toHaveCSS('width', '76px')
      await expect(rail.getByRole('button', { name: 'Expand sidebar' })).toBeVisible()
      await rail.getByRole('button', { name: /Driving, \d+ pages/ }).hover()
      await expect(page.getByTestId('rail-tip')).toBeVisible()
      await expect(sidebar).toHaveCSS('z-index', '20')
      await captureDeck(page, testInfo, 'deck-compact-hover')
      await rail.getByRole('button', { name: 'Expand sidebar' }).click()
      await expect(sidebar).toHaveCSS('width', '240px')
      await rail.getByRole('link', { name: 'Display' }).click()
      await expect(page).toHaveURL(/\/settings#appearance$/)
      await expect(page.locator('#appearance').getByRole('heading', { name: 'Appearance' })).toBeVisible()
      await expect(page.locator('#main-content nav[aria-label*="sections"]')).toHaveCount(0)
    } else {
      // Mobile drawer opens on the rail; tapping drills into the panel.
      await expect(rail.getByRole('button', { name: /Driving, \d+ pages/ })).toBeVisible()
      await expect(rail.getByRole('button', { name: 'Collapse sidebar' })).toHaveCount(0)
      await captureDeck(page, testInfo, 'deck-mobile-rail')
      await rail.getByRole('button', { name: /Driving, \d+ pages/ }).click()
      await expect(nav.getByRole('link', { name: 'Regen Braking' })).toBeVisible()
      await expect(nav.getByText('Driving Performance')).toBeVisible()
      await nav.getByRole('button', { name: 'Expand all groups' }).click()
      await nav.getByRole('button', { name: 'Collapse all groups' }).click()
      await expect(nav.getByRole('link', { name: 'Regen Braking' })).toHaveCount(0)
      await nav.getByRole('button', { name: 'Expand all groups' }).click()
      await nav.getByRole('button', { name: 'Driving Performance' }).click()
      await expect(nav.getByRole('link', { name: 'Regen Braking' })).toHaveCount(0)
      await nav.getByRole('button', { name: 'Driving Performance' }).click()
      await captureDeck(page, testInfo, 'deck-mobile-section')
      await nav.getByRole('button', { name: 'Back to sections' }).click()
      await expect(rail.getByRole('button', { name: /Driving, \d+ pages/ })).toBeVisible()

      // Search from the rail, then following a link closes the drawer.
      await rail.getByRole('button', { name: 'Search' }).click()
      await sidebar.getByRole('combobox', { name: 'Search pages' }).fill('Drive DNA')
      await expect(nav.getByText('1 results')).toBeVisible()
      await nav.getByRole('link', { name: /Drive DNA/ }).click()
      await expect(page).toHaveURL(/\/drive-dna$/)
      await expect(page.getByRole('button', { name: 'Open sidebar' })).toBeVisible()
    }
  })
}

for (const width of [390, 1440]) {
  test(`opens only the current Drive Calendar group at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    await seedBrowserState(page, 'light', '/drive-calendar')
    const mockApi = await installApiMocks(page, 'populated', 'light')
    await page.goto('/drive-calendar', { waitUntil: 'domcontentloaded' })
    await waitForHarnessReady(page, mockApi)
    await openSidebarOnMobile(page, width)

    const rail = page.getByRole('navigation', { name: 'Sections and shortcuts' })
    await rail.getByRole('button', { name: /Driving, \d+ pages/ }).click()
    const panel = page.getByRole('navigation', { name: 'Sidebar navigation' })
    await expect(panel.getByRole('button', { name: 'Drive Records' })).toHaveAttribute('aria-expanded', 'true')
    await expect(panel.getByRole('button', { name: 'Trip Records' })).toHaveAttribute('aria-expanded', 'false')
    await expect(panel.getByRole('link', { name: 'Drive Calendar' })).toHaveAttribute('aria-current', 'page')
    await expect(panel.getByRole('link', { name: 'Trips' })).toHaveCount(0)
    if (width >= 1280) {
      const railColor = await rail.evaluate(element => getComputedStyle(element).backgroundColor)
      const panelColor = await panel.evaluate(element => getComputedStyle(element).backgroundColor)
      expect(railColor).not.toBe(panelColor)
    }
    await captureDeck(page, testInfo, `deck-drive-calendar-${width}`)
  })

  test(`keeps the command deck legible in light mode at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    await seedBrowserState(page, 'light', '/driving-dynamics')
    const mockApi = await installApiMocks(page, 'populated', 'light')
    await page.goto('/driving-dynamics', { waitUntil: 'domcontentloaded' })
    await waitForHarnessReady(page, mockApi)
    await expectThemeApplied(page, 'light')
    await openSidebarOnMobile(page, width)

    const rail = page.getByRole('navigation', { name: 'Sections and shortcuts' })
    await expect(rail.getByRole('button', { name: /Driving, \d+ pages/ })).toBeVisible()
    await captureDeck(page, testInfo, `deck-light-rail-${width}`)
    await rail.getByRole('button', { name: /Driving, \d+ pages/ }).click()
    await expect(page.getByRole('navigation', { name: 'Sidebar navigation' }).getByRole('button', { name: 'Driving Performance' })).toBeVisible()
    await captureDeck(page, testInfo, `deck-light-section-${width}`)
    if (width >= 1280) {
      await page.getByRole('navigation', { name: 'Sidebar navigation' })
        .getByRole('button', { name: 'Collapse secondary navigation' }).click()
      await expect(page.locator('[data-role="sidebar"]')).toHaveCSS('width', '152px')
      await captureDeck(page, testInfo, 'deck-light-compact-secondary')
    }
  })
}
