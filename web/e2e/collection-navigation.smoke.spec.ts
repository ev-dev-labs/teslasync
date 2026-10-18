import { expect, test, type Page, type TestInfo } from '@playwright/test'
import { expectThemeApplied, installApiMocks, seedBrowserState, waitForHarnessReady } from './mockApi'

async function openPanelOnDesktop(page: Page) {
  if (await page.getByTestId('command-deck-secondary').count() === 0) {
    await page.locator('.sidenav-rail').getByRole('button', { name: 'Driving' }).click()
  }
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

    if (width >= 1280) {
      const rail = page.getByRole('navigation', { name: 'Sections and shortcuts' })
      const nav = page.getByRole('navigation', { name: 'Sidebar navigation' })
      await expect(rail).toHaveCSS('background-color', 'rgb(11, 13, 18)')
      // Section rail with utilities; the context panel starts open on desktop.
      await expect(rail.getByRole('button', { name: 'Search' })).toHaveCount(0)
      await expect(page.locator('[data-role="workspace-header"]').getByRole('button', { name: 'Search pages, commands…' })).toBeVisible()
      await expect(rail.getByRole('button', { name: 'Driving' })).toBeVisible()
      await expect(rail.getByRole('button', { name: 'Driving' })).toHaveAttribute('aria-expanded', 'true')
      await expect(rail.getByRole('link', { name: 'Cars' })).toHaveCount(0)
      await expect(rail.getByRole('button', { name: 'Open theme picker' })).toBeVisible()
      await expect(page.getByTestId('command-deck-secondary')).toHaveCount(1)
      // Docked, not floating: the rail and panel columns sit side by side.
      await expect(page.getByTestId('command-deck-rail')).toHaveCSS('width', '76px')
      await expect(page.getByTestId('command-deck-secondary')).toHaveCSS('width', '272px')
      await captureDeck(page, testInfo, 'deck-rail')

      await rail.getByRole('button', { name: 'Vehicles' }).click()
      await expect(nav).toHaveCSS('background-color', 'rgb(17, 21, 28)')
      await expect(nav.getByRole('link', { name: /^My vehicles/ })).toBeVisible()

      // Section switch: the panel follows the rail selection.
      await rail.getByRole('button', { name: 'Driving' }).click()
      await expect(nav).toHaveCSS('background-color', 'rgb(17, 21, 28)')
      const selectedSection = rail.getByRole('button', { name: 'Driving' })
      await expect(selectedSection).toHaveAttribute('aria-expanded', 'true')
      const primaryColor = await selectedSection.evaluate(element => getComputedStyle(element).color)
      const inactivePrimaryColor = await rail.getByRole('button', { name: 'Charging' })
        .evaluate(element => getComputedStyle(element).color)
      expect(primaryColor).not.toBe(inactivePrimaryColor)
      const sectionFilter = nav.getByRole('searchbox', { name: 'Filter Driving pages' })
      await sectionFilter.fill('Drive DNA')
      await expect(nav.getByRole('link', { name: 'Drive DNA' })).toBeVisible()
      await expect(nav.getByRole('link', { name: 'Drive calendar' })).toHaveCount(0)
      await nav.getByRole('button', { name: 'Clear filter' }).click()
      await expect(nav.getByRole('button', { name: 'Driving performance' })).toHaveAttribute('aria-expanded', 'true')
      await expect(nav.getByRole('button', { name: 'Drive records' })).toHaveAttribute('aria-expanded', 'false')
      await nav.getByRole('button', { name: 'Expand all groups' }).click()
      await expect(nav.getByRole('link', { name: 'Regen braking', exact: true })).toBeVisible()
      await nav.getByRole('button', { name: 'Collapse all groups' }).click()
      await expect(nav.getByRole('link', { name: 'Regen braking', exact: true })).toHaveCount(0)
      await nav.getByRole('button', { name: 'Expand all groups' }).click()
      await expect(nav.getByRole('link', { name: 'Regen braking', exact: true })).toBeVisible()
      const selectedPage = nav.getByRole('link', { name: 'Driving dynamics' })
      await expect(selectedPage).toHaveAttribute('aria-current', 'page')
      const currentColor = await selectedPage.evaluate(element => getComputedStyle(element).color)
      const otherColor = await nav.getByRole('link', { name: 'Drive DNA' })
        .evaluate(element => getComputedStyle(element).color)
      expect(currentColor).not.toBe(otherColor)
      await expect(nav.getByText('Driving performance')).toBeVisible()
      await nav.getByRole('button', { name: 'Driving performance' }).click()
      await expect(nav.getByRole('link', { name: 'Regen braking', exact: true })).toHaveCount(0)
      await nav.getByRole('button', { name: 'Driving performance' }).click()
      await expect(nav.getByRole('link', { name: 'Regen braking', exact: true })).toBeVisible()
      await captureDeck(page, testInfo, 'deck-section')
      await nav.getByRole('link', { name: 'Drive DNA' }).dblclick()
      await expect(nav.getByRole('button', { name: 'Unpin Drive DNA' }).first()).toBeVisible()
      await expect(nav.getByRole('link', { name: 'Quick access: Drive DNA' })).toBeVisible()
      await nav.getByRole('button', { name: 'Unpin Drive DNA' }).first().click()
      await expect(nav.getByRole('link', { name: 'Quick access: Drive DNA' })).toHaveCount(0)
      // The previous double-click also followed its link: return to the page under test.
      await nav.getByRole('link', { name: 'Driving dynamics' }).first().click()
      await expect(page).toHaveURL(/\/driving-dynamics$/)
      const currentPage = nav.locator('a[aria-current="page"]', { hasText: 'Driving dynamics' })
      await expect(currentPage).toBeVisible()
      // The current page stays in its canonical group, never duplicated as a quick pin.
      await currentPage.dblclick()
      await expect(nav.getByRole('button', { name: 'Unpin Driving dynamics' })).toBeVisible()
      await expect(nav.getByRole('link', { name: 'Quick access: Driving dynamics' })).toHaveCount(0)
      await nav.getByRole('button', { name: 'Unpin Driving dynamics' }).click()
      const regen = nav.getByRole('link', { name: 'Regen braking', exact: true })
      const pinRegen = nav.getByRole('button', { name: 'Pin Regen braking to favorites' })
      await pinRegen.click()
      await expect(regen).toBeVisible()
      await expect(nav.getByRole('button', { name: 'Unpin Regen braking' }).first()).toBeVisible()
      await expect(nav.getByRole('link', { name: 'Quick access: Regen braking' })).toBeVisible()
      await nav.getByRole('button', { name: 'Unpin Regen braking' }).first().click()
      await expect(nav.getByRole('link', { name: 'Quick access: Regen braking' })).toHaveCount(0)

      // Suggested carries reason lines; Escape no longer closes the panel.
      await rail.getByRole('button', { name: 'Home' }).click()
      await expect(nav.getByRole('button', { name: /Suggested/ })).toBeVisible()
      await nav.getByRole('button', { name: /Suggested/ }).click()
      await expect(nav.getByText(/Related to /)).toHaveCount(4)
      await page.keyboard.press('Escape')
      await expect(page.getByTestId('command-deck-secondary')).toHaveCount(1)
      await captureDeck(page, testInfo, 'deck-suggested')

      // Saved lists pins from every section.
      await nav.getByRole('button', { name: 'Home' }).click()
      await nav.getByRole('button', { name: /Saved/ }).click()
      await expect(nav.getByRole('link', { name: /^My vehicles/ }).first()).toBeVisible()
      await captureDeck(page, testInfo, 'deck-saved')
      await rail.getByRole('button', { name: 'Driving' }).click()

      // The panel hides and reopens from the rail; the rail stays put.
      await nav.getByRole('button', { name: 'Hide panel' }).click()
      await expect(page.getByTestId('command-deck-secondary')).toHaveCount(0)
      await expect(rail.getByRole('button', { name: 'Driving' })).toHaveAttribute('aria-expanded', 'false')
      await expect(page.getByTestId('command-deck-rail')).toHaveCSS('width', '76px')
      await rail.getByRole('button', { name: 'Driving' }).click()
      await expect(page.getByTestId('command-deck-secondary')).toHaveCount(1)

      // Rail sections show short labels and deliberately expose no hover
      // tooltip (polish); resting bubbles stay at opacity 0.
      await rail.getByRole('button', { name: 'Driving' }).hover()
      const shownTooltips = await page.getByRole('tooltip').evaluateAll(elements =>
        elements.filter(element => getComputedStyle(element).opacity !== '0').length)
      expect(shownTooltips).toBe(0)
      await captureDeck(page, testInfo, 'deck-rail-hover')

      // The rail display control reaches appearance settings.
      await rail.getByRole('button', { name: 'Open theme picker' }).click()
      await expect(page.getByRole('dialog', { name: 'Open theme picker' })).toBeVisible()
      await page.getByRole('button', { name: 'Customize…' }).click()
      await expect(page).toHaveURL(/\/settings#appearance$/)
      await expect(page.locator('#appearance').getByRole('heading', { name: 'Appearance' })).toBeVisible()
      await expect(page.locator('#main-content nav[aria-label*="sections"]')).toHaveCount(0)
    } else {
      // Mobile tabs open the section sheet; More opens the section grid.
      const tabs = page.getByRole('navigation', { name: 'Quick navigation' })
      await expect(page.getByRole('button', { name: 'Open sidebar' })).toBeVisible()
      await expect(tabs.getByRole('button', { name: 'Driving' })).toBeVisible()
      await captureDeck(page, testInfo, 'deck-mobile-tabs')
      await tabs.getByRole('button', { name: 'Driving' }).click()
      const sheet = page.locator('.sidenav-sheet')
      const nav = sheet.getByRole('navigation', { name: 'Sidebar navigation' })
      await expect(nav.getByRole('link', { name: 'Regen braking', exact: true })).toBeVisible()
      await expect(nav.getByText('Driving performance')).toBeVisible()
      await nav.getByRole('button', { name: 'Expand all groups' }).click()
      await nav.getByRole('button', { name: 'Collapse all groups' }).click()
      await expect(nav.getByRole('link', { name: 'Regen braking', exact: true })).toHaveCount(0)
      await nav.getByRole('button', { name: 'Expand all groups' }).click()
      await nav.getByRole('button', { name: 'Driving performance' }).click()
      await expect(nav.getByRole('link', { name: 'Regen braking', exact: true })).toHaveCount(0)
      await nav.getByRole('button', { name: 'Driving performance' }).click()
      await captureDeck(page, testInfo, 'deck-mobile-section')
      await page.keyboard.press('Escape')
      await expect(sheet).toHaveCount(0)

      // The header browse button opens More, which lists only sections
      // without a tab; tapping drills into the panel.
      await page.getByRole('button', { name: 'Open sidebar' }).click()
      await expect(sheet.getByRole('button', { name: 'Driving' })).toHaveCount(0)
      await expect(sheet.getByRole('button', { name: 'Battery' })).toBeVisible()
      await captureDeck(page, testInfo, 'deck-mobile-more')
      await sheet.getByRole('button', { name: 'Battery' }).click()
      await expect(sheet.getByRole('navigation', { name: 'Sidebar navigation' })).toBeVisible()
      await expect(sheet.locator('button[aria-expanded]').first()).toBeVisible()
      await page.keyboard.press('Escape')

      // Mobile keeps one global command palette via the keyboard shortcut.
      await page.keyboard.press('ControlOrMeta+k')
      await expect(page.getByRole('dialog', { name: 'Command palette' })).toBeVisible()
      await page.keyboard.press('Escape')
    }

  })
}

test('sidebar selection follows the saved accent color and live accent changes', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await seedBrowserState(page, 'light', '/drive-calendar')
  const mockApi = await installApiMocks(page, 'populated', 'light', 'comfortable', 'solar-amber')
  await page.goto('/drive-calendar', { waitUntil: 'domcontentloaded' })
  await waitForHarnessReady(page, mockApi)

  const rail = page.getByRole('navigation', { name: 'Sections and shortcuts' })
  const section = rail.getByRole('button', { name: 'Driving' })
  await openPanelOnDesktop(page)
  const panel = page.getByRole('navigation', { name: 'Sidebar navigation' })
  const indicator = panel.getByRole('link', { name: 'Drive calendar' })
    .locator('xpath=..').locator(':scope > span[aria-hidden]').first()
  await expect(indicator).toHaveCSS('background-color', 'rgb(245, 158, 11)')
  const chip = section.locator('.sidenav-icon')
  await expect(chip).toHaveCSS('background-color', 'rgb(217, 119, 6)')

  await page.evaluate(() => {
    document.documentElement.style.setProperty('--theme-primary', '#e31937')
    document.documentElement.style.setProperty('--theme-accent', '#e31937')
  })
  await expect(indicator).toHaveCSS('background-color', 'rgb(227, 25, 55)')
  await expect(chip).toHaveCSS('background-color', 'rgb(227, 25, 55)')
})

for (const width of [390, 1440]) {
  test(`opens only the current Drive calendar group at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    await seedBrowserState(page, 'light', '/drive-calendar')
    const mockApi = await installApiMocks(page, 'populated', 'light')
    await page.goto('/drive-calendar', { waitUntil: 'domcontentloaded' })
    await waitForHarnessReady(page, mockApi)

    if (width >= 1280) {
      const rail = page.getByRole('navigation', { name: 'Sections and shortcuts' })
      await expect(rail).toHaveCSS('background-color', 'rgb(248, 250, 252)')
      await openPanelOnDesktop(page)
      const panel = page.getByRole('navigation', { name: 'Sidebar navigation' })
      await expect(panel.getByRole('button', { name: 'Drive records' })).toHaveAttribute('aria-expanded', 'true')
      await expect(panel.getByRole('button', { name: 'Trip records' })).toHaveAttribute('aria-expanded', 'false')
      await expect(panel.getByRole('button', { name: 'Journey planning' })).toHaveAttribute('aria-expanded', 'false')
      await expect(panel.getByRole('button', { name: 'Driving insights' })).toHaveAttribute('aria-expanded', 'false')
      await expect(panel.getByRole('button', { name: 'Driving performance' })).toHaveAttribute('aria-expanded', 'false')
      await expect(panel.getByRole('link', { name: 'Drive calendar' })).toHaveAttribute('aria-current', 'page')
      await expect(panel.getByRole('link', { name: 'Trips' })).toHaveCount(0)
      await expect(panel).toHaveCSS('background-color', 'rgb(250, 251, 252)')
      const activeIndicator = panel.getByRole('link', { name: 'Drive calendar' })
        .locator('xpath=..').locator(':scope > span[aria-hidden]').first()
      await expect(activeIndicator).toHaveCSS('width', '2px')
      await expect(activeIndicator).toHaveCSS('background-color', 'rgb(59, 130, 246)')
      await expect(rail.getByRole('button', { name: 'Driving' })).toHaveAttribute('aria-expanded', 'true')
      const railColor = await rail.evaluate(element => getComputedStyle(element).backgroundColor)
      const panelColor = await panel.evaluate(element => getComputedStyle(element).backgroundColor)
      expect(railColor).not.toBe(panelColor)
      await captureDeck(page, testInfo, `deck-drive-calendar-${width}`)
    } else {
      const tabs = page.getByRole('navigation', { name: 'Quick navigation' })
      await expect(tabs.getByRole('button', { name: 'Driving' })).toHaveAttribute('aria-current', 'true')
      await tabs.getByRole('button', { name: 'Driving' }).click()
      const panel = page.locator('.sidenav-sheet').getByRole('navigation', { name: 'Sidebar navigation' })
      await expect(panel.getByRole('button', { name: 'Drive records' })).toHaveAttribute('aria-expanded', 'true')
      await expect(panel.getByRole('link', { name: 'Drive calendar' })).toHaveAttribute('aria-current', 'page')
      await captureDeck(page, testInfo, `deck-drive-calendar-${width}`)
    }
  })

  test(`keeps the command deck legible in light mode at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    await seedBrowserState(page, 'light', '/driving-dynamics')
    const mockApi = await installApiMocks(page, 'populated', 'light')
    await page.goto('/driving-dynamics', { waitUntil: 'domcontentloaded' })
    await waitForHarnessReady(page, mockApi)
    await expectThemeApplied(page, 'light')

    if (width >= 1280) {
      const rail = page.getByRole('navigation', { name: 'Sections and shortcuts' })
      await expect(rail).toHaveCSS('background-color', 'rgb(248, 250, 252)')
      await expect(rail.getByRole('button', { name: 'Driving' })).toBeVisible()
      await captureDeck(page, testInfo, `deck-light-rail-${width}`)
      await openPanelOnDesktop(page)
      const panel = page.getByRole('navigation', { name: 'Sidebar navigation' })
      await expect(panel).toHaveCSS('background-color', 'rgb(250, 251, 252)')
      await expect(panel.getByRole('button', { name: 'Driving performance' })).toBeVisible()
      await captureDeck(page, testInfo, `deck-light-section-${width}`)
      await panel.getByRole('button', { name: 'Hide panel' }).click()
      await expect(page.getByTestId('command-deck-secondary')).toHaveCount(0)
      await expect(rail).toHaveCSS('background-color', 'rgb(248, 250, 252)')
      await expect(rail.getByRole('button', { name: 'Driving' })).toBeVisible()
      await captureDeck(page, testInfo, 'deck-light-rail-only')
    } else {
      const tabs = page.getByRole('navigation', { name: 'Quick navigation' })
      await expect(tabs.getByRole('button', { name: 'Driving' })).toBeVisible()
      await captureDeck(page, testInfo, `deck-light-tabs-${width}`)
      await tabs.getByRole('button', { name: 'Driving' }).click()
      const panel = page.locator('.sidenav-sheet').getByRole('navigation', { name: 'Sidebar navigation' })
      await expect(panel).toHaveCSS('background-color', 'rgb(250, 251, 252)')
      await expect(panel.getByRole('button', { name: 'Driving performance' })).toBeVisible()
      await captureDeck(page, testInfo, `deck-light-sheet-${width}`)
    }
  })
}
