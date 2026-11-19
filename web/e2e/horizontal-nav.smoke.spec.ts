import { expect, test, type Locator, type Page, type Request } from '@playwright/test'
import { join } from 'node:path'
import { assertMockApiComplete, closeMockApiFixtures, waitForHarnessReady } from './mockApi'
import { createReviewPreference, installPackReview, packNames, selectReviewPack } from './widget-design-packs.mock'
import { APPLICATION_DESIGNS } from '../src/components/ui/app-designs/designs'
import { COLLECTION_DEFINITIONS } from '../src/components/layout/sidebar/collections'
import type { PackId } from '../src/features/dashboard/widgets/designPacks/types'

test.afterAll(async () => { await closeMockApiFixtures() })

async function openNavigation(page: Page, baseURL: string, width: number, pack: PackId = 'v6', theme: 'dark' | 'light' = 'dark') {
  const origin = new URL(baseURL).origin
  await page.setViewportSize({ width, height: 900 })
  const preference = { ...createReviewPreference(), pack_id: pack, app_wide: true }
  const mocks = await installPackReview(page, theme, width, false, [], true, preference, origin)
  await page.addInitScript(() => localStorage.setItem('teslasync-deck-panel-open', '0'))
  await page.goto('/explore', { waitUntil: 'domcontentloaded' })
  await waitForHarnessReady(page, mocks)
  return mocks
}

async function expectAnchored(page: Page, trigger: Locator, panel: Locator, rtl = false, clip?: Locator) {
  await expect(panel).toBeInViewport({ ratio: 1 })
  await expect.poll(async () => {
    const anchor = (await trigger.boundingBox())!
    const box = (await panel.boundingBox())!
    const ideal = rtl ? anchor.x + anchor.width - box.width : anchor.x
    const container = await clip?.boundingBox()
    const left = container?.x ?? 0
    const right = container ? container.x + container.width : page.viewportSize()!.width
    const expected = Math.max(left + 8, Math.min(ideal, right - box.width - 8))
    return Math.abs(box.x - expected)
  }).toBeLessThanOrEqual(1)
  const anchor = (await trigger.boundingBox())!
  expect((await panel.boundingBox())!.y).toBeGreaterThanOrEqual(anchor.y + anchor.height)
}

async function reviewAppearance(page: Page, screenshotPath: string) {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/settings#appearance')
  await page.getByRole('button', { name: `Preview ${packNames.deco}`, exact: true }).click()
  const preview = page.locator('[data-app-design-preview][data-preview-synthetic]')
  const commands = preview.getByRole('button', { name: 'Commands', exact: true })
  const panel = preview.locator('[data-role="section-flyout"]')
  const writes: string[] = []
  const trackWrites = (request: Request) => {
    if (new URL(request.url()).pathname.startsWith('/api/') && request.method() !== 'GET') writes.push(request.url())
  }
  page.on('request', trackWrites)
  const url = page.url()
  await commands.click()
  await expectAnchored(page, commands, panel, false, page.getByRole('dialog', { name: `Preview ${packNames.deco}`, exact: true }).locator('[data-modal-scroll-body]'))
  await expect(panel).toHaveAttribute('data-app-design-owner', /\bpack-deco\b/)
  await page.screenshot({ path: screenshotPath })
  await page.keyboard.press('Escape')
  await expect(commands).toBeFocused()
  await expect(panel).toHaveCount(0)
  await expect(preview).toBeVisible()
  await commands.click()
  await panel.getByRole('menuitem', { name: 'Activity', exact: true }).click()
  await expect(panel).toHaveCount(0)
  await expect(commands).toHaveAttribute('aria-current', 'true')
  expect(page.url()).toBe(url)
  await expect(page.locator('html')).toHaveAttribute('data-app-design-pack', 'v6')
  expect(writes).toEqual([])
  page.off('request', trackWrites)
  await page.getByRole('button', { name: 'Close preview', exact: true }).click()
}

test('all packs keep the Driving secondary aligned and contained at laptop and desktop sizes', async ({ page, baseURL }, testInfo) => {
  testInfo.setTimeout(180_000)
  const mocks = await openNavigation(page, baseURL!, 1440, 'classic')
  const nav = page.getByRole('navigation', { name: 'Primary', exact: true })
  const flyout = page.locator('[data-role="section-flyout"]')
  const rail = page.getByTestId('command-deck-rail')
  const side = page.getByTestId('atlas-panel-secondary')
  for (const [index, [id, design]] of Object.entries(APPLICATION_DESIGNS).entries()) {
    const pack = id as PackId
    if (pack !== 'classic') await selectReviewPack(page, pack)
    await expect(page.locator('html')).toHaveAttribute('data-app-design-pack', pack)
    // Start each pack at the preceding pack's final width so only one resize is needed.
    for (const width of index % 2 === 0 ? [1440, 1024] : [1024, 1440]) {
      await test.step(`${pack} at ${width}×768`, async () => {
        const viewport = page.viewportSize()
        if (viewport?.width !== width || viewport.height !== 768) {
          await page.setViewportSize({ width, height: 768 })
        }
        const top = design.navigation === 'top'
        const trigger = (top ? nav : rail).getByRole('button', { name: 'Driving', exact: true })
        if (top) {
          await expect(rail).toHaveCount(0)
          await expect(nav.getByRole('button', { name: 'More', exact: true })).toHaveCount(0)
          await expect(trigger.locator('svg')).toHaveCount(1)
        }
        else {
          await expect(side).toHaveCount(0)
          await expect(rail.getByRole('button', { name: 'More', exact: true })).toHaveCount(0)
          await expect(rail.getByRole('button', { name: 'Diagnostics', exact: true })).toHaveCount(1)
          await expect(trigger).toHaveAttribute('data-app-design-owner', new RegExp(`\\bpack-${pack}\\b`))
        }
        await trigger.press('ArrowDown')
        const panel = top ? flyout : side
        await expect(panel).toBeInViewport({ ratio: 1 })
        await expect(top ? side : flyout).toHaveCount(0)
        await expect(panel.getByRole('searchbox', { name: 'Filter Driving pages' })).toBeVisible()
        if (top) {
          await expectAnchored(page, trigger, panel)
          const header = await page.locator('[data-role="horizontal-header"]').boundingBox()
          expect((await panel.boundingBox())!.y).toBeGreaterThanOrEqual(header!.y + header!.height - 1)
          await expect(panel.getByRole('menu', { name: 'Drive records', exact: true })).toBeInViewport({ ratio: 1 })
        } else {
          await expect(panel).toHaveAttribute('data-app-design-owner', new RegExp(`\\bpack-${pack}\\b`))
          const railBox = await rail.boundingBox()
          const panelBox = await (width < 1280 ? page.locator('.sidenav-tablet-panel') : panel).boundingBox()
          expect(Math.abs(panelBox!.x - railBox!.x - railBox!.width)).toBeLessThanOrEqual(1)
          if (pack === 'material') {
            const icon = trigger.locator('.sidenav-icon')
            const firstPage = panel.getByRole('link', { name: /^Drives/ })
            await expect.poll(async () => parseFloat(await icon.evaluate(element => getComputedStyle(element).borderTopLeftRadius))).toBeGreaterThan(30)
            await expect.poll(async () => parseFloat(await firstPage.evaluate(element => getComputedStyle(element).borderTopLeftRadius))).toBeGreaterThan(30)
          }
        }
        await page.keyboard.press('Escape')
        await expect(panel).toHaveCount(0)
        await expect(trigger).toBeFocused()
        if (pack === 'atlas' && width === 1440) {
          const settings = rail.getByRole('button', { name: 'Settings', exact: true })
          await settings.click()
          await expect(side.getByRole('searchbox', { name: 'Filter Settings pages' })).toBeVisible()
          await expect(side.locator('[data-app-nav-slot="heading"]')).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
          await expect(side.getByRole('button', { name: 'Pinned', exact: true })).toHaveCount(0)
          await page.keyboard.press('Escape')
          await expect(side).toHaveCount(0)
          await expect(settings).toBeFocused()
        }
      })
    }
  }
  await assertMockApiComplete(page, mocks)
})

test('horizontal sections scroll with edge fades and the flyout switches groups by keyboard and pointer', async ({ page, baseURL }) => {
  const mocks = await openNavigation(page, baseURL!, 1440)
  const nav = page.getByRole('navigation', { name: 'Primary', exact: true })
  const driving = nav.getByRole('button', { name: 'Driving', exact: true })
  const sectionButtons = nav.locator('[data-horizontal-nav-trigger]')
  await expect(driving).toBeVisible()
  const wideCount = await sectionButtons.count()
  const leftFade = page.getByTestId('horizontal-rail-fade-left')
  const rightFade = page.getByTestId('horizontal-rail-fade-right')
  await expect(leftFade).toHaveAttribute('data-visible', 'false')
  await expect(rightFade).toHaveAttribute('data-visible', 'true')
  await page.setViewportSize({ width: 1024, height: 540 })
  await expect(nav.getByRole('button', { name: 'More', exact: true })).toHaveCount(0)
  await expect(sectionButtons).toHaveCount(wideCount)
  await driving.press('End')
  await expect(sectionButtons.last()).toBeFocused()
  await expect(leftFade).toHaveAttribute('data-visible', 'true')
  await expect(rightFade).toHaveAttribute('data-visible', 'false')
  await expect(leftFade).toHaveCSS('pointer-events', 'none')
  await expect(rightFade).toHaveCSS('pointer-events', 'none')
  const railBounds = (await nav.locator('[data-horizontal-rail]').boundingBox())!
  const lastBounds = (await sectionButtons.last().boundingBox())!
  expect(lastBounds.x).toBeGreaterThanOrEqual(railBounds.x)
  expect(lastBounds.x + lastBounds.width).toBeLessThanOrEqual(railBounds.x + railBounds.width)
  await page.keyboard.press('Home')
  await expect(sectionButtons.first()).toBeFocused()
  await expect(leftFade).toHaveAttribute('data-visible', 'false')
  await expect(rightFade).toHaveAttribute('data-visible', 'true')
  await page.keyboard.press('ArrowRight')
  await expect(sectionButtons.nth(1)).toBeFocused()

  await driving.press('ArrowDown')
  const flyout = page.locator('[data-role="section-flyout"]')
  await expect(flyout.getByRole('heading', { name: 'Driving', exact: true })).toBeVisible()
  await expect(flyout.getByRole('heading', { name: 'Driving', exact: true }).locator('svg')).toBeVisible()
  const groups = page.getByRole('menu', { name: 'Driving groups' })
  const records = groups.getByRole('menuitem', { name: /^Drive records/ })
  await expect(records).toBeFocused()
  const pages = page.getByRole('menu', { name: 'Drive records', exact: true })
  await expect(pages).toBeInViewport({ ratio: 1 })
  await page.keyboard.press('ArrowRight')
  await expect(pages.getByRole('menuitem', { name: /^Drives/ })).toBeFocused()
  await page.keyboard.press('ArrowLeft')
  await expect(records).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await expect(records).toHaveAttribute('aria-expanded', 'false')
  await expect(pages).toHaveCount(0)
  await records.hover()
  await expect(records).toHaveAttribute('aria-expanded', 'true')
  await driving.focus()
  await driving.press('ArrowDown')
  await expect(records).toBeFocused()

  await page.getByRole('searchbox', { name: 'Filter Driving pages' }).fill('Drive DNA')
  await expect(page.getByRole('menuitem', { name: 'Drive DNA', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(driving).toBeFocused()
  await expect(driving).toHaveAttribute('aria-expanded', 'false')

  await selectReviewPack(page, 'deco')
  await expect(page.locator('html')).toHaveAttribute('data-app-design-pack', 'deco')
  await driving.press('ArrowDown')
  await expect(flyout).toHaveCSS('border-top-style', 'double')
  await flyout.getByRole('button', { name: 'Hide panel', exact: true }).click()
  await expect(flyout).toHaveCount(0)
  await expect(driving).toBeFocused()
  await assertMockApiComplete(page, mocks)
})

test('anchored geometry, dismissal, RTL and the isolated Appearance preview', async ({ page, baseURL }, testInfo) => {
  testInfo.setTimeout(120_000)
  const mocks = await openNavigation(page, baseURL!, 1920)
  const header = page.locator('[data-role="horizontal-header"]').first()
  const nav = header.getByRole('navigation', { name: 'Primary', exact: true })
  const home = nav.getByRole('button', { name: 'Home', exact: true })
  const commands = nav.getByRole('button', { name: 'Commands', exact: true })
  const account = header.getByRole('button', { name: 'Account', exact: true })
  const panel = header.locator('[data-role="section-flyout"]')
  const lane = nav.locator('[data-horizontal-rail]')
  await home.click()
  await expectAnchored(page, home, panel)
  const homeX = (await panel.boundingBox())!.x
  await commands.click()
  await expectAnchored(page, commands, panel)
  expect((await panel.boundingBox())!.x - homeX).toBeGreaterThan(200)
  await expect(home).toHaveAttribute('aria-current', 'true')
  await expect(home).toHaveAttribute('aria-expanded', 'false')
  await expect(commands).not.toHaveAttribute('aria-current')
  await expect(commands).toHaveAttribute('aria-expanded', 'true')
  await page.screenshot({ path: testInfo.outputPath('commands-dark-desktop.png') })
  await page.keyboard.press('Escape')
  await expect(commands).toBeFocused()
  await account.click()
  await expectAnchored(page, account, panel)
  await page.setViewportSize({ width: 1800, height: 900 })
  await expectAnchored(page, account, panel)
  await page.setViewportSize({ width: 1920, height: 900 })
  await expectAnchored(page, account, panel)
  await panel.getByRole('button', { name: 'Hide panel' }).click()
  await expect(account).toBeFocused()

  await commands.click()
  const beforeScroll = (await panel.boundingBox())!.x
  const toolsBeforeScroll = await header.locator('.horizontal-nav-tools').boundingBox()
  await lane.evaluate(element => { element.scrollLeft += 80 })
  await expectAnchored(page, commands, panel)
  await expect(page.getByTestId('horizontal-rail-fade-left')).toHaveAttribute('data-visible', 'true')
  await expect(page.getByTestId('horizontal-rail-fade-right')).toHaveAttribute('data-visible', 'true')
  expect(await header.locator('.horizontal-nav-tools').boundingBox()).toEqual(toolsBeforeScroll)
  expect((await panel.boundingBox())!.x).toBeLessThan(beforeScroll - 60)
  await home.click()
  await expectAnchored(page, home, panel)
  await lane.evaluate(element => { element.scrollLeft = element.scrollWidth })
  expect((await home.boundingBox())!.x + (await home.boundingBox())!.width).toBeLessThan((await lane.boundingBox())!.x)
  await expect(panel).toHaveCount(0)
  await commands.click()
  await expectAnchored(page, commands, panel)
  const search = page.getByRole('searchbox', { name: /Filter features/ })
  await search.click()
  await expect(panel).toHaveCount(0)
  await expect(search).toBeFocused()

  await page.setViewportSize({ width: 1024, height: 900 })
  await commands.press('ArrowDown')
  await expectAnchored(page, commands, panel)
  await page.screenshot({ path: testInfo.outputPath('commands-dark-1024.png') })
  await page.setViewportSize({ width: 1023, height: 900 })
  await expect(panel).toHaveCount(0)
  const browse = header.getByRole('button', { name: 'Browse sections' })
  await expect(browse).toBeFocused()
  await browse.click()
  await expect(page.getByRole('dialog', { name: 'Browse sections' })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('browse-dark-1023.png') })
  await page.keyboard.press('Escape')
  await expect(browse).toBeFocused()

  await page.setViewportSize({ width: 1920, height: 900 })
  await page.evaluate(() => { document.documentElement.dir = 'rtl' })
  await home.focus()
  await home.press('ArrowLeft')
  await expect(nav.getByRole('button', { name: 'Vehicles', exact: true })).toBeFocused()
  await commands.press('ArrowDown')
  await expectAnchored(page, commands, panel, true)
  await page.screenshot({ path: testInfo.outputPath('commands-dark-rtl.png') })
  await page.keyboard.press('Escape')
  await expect(commands).toBeFocused()
  await commands.press('End')
  await expect(page.getByTestId('horizontal-rail-fade-right')).toHaveAttribute('data-visible', 'true')
  await expect(page.getByTestId('horizontal-rail-fade-left')).toHaveAttribute('data-visible', 'false')
  await page.evaluate(() => { document.documentElement.dir = 'ltr' })
  await reviewAppearance(page, testInfo.outputPath('appearance-dark-open.png'))
  await assertMockApiComplete(page, mocks)

  // Reuse the same scenario in light mode, not another pack/viewport matrix.
  await page.unrouteAll({ behavior: 'wait' })
  const lightMocks = await openNavigation(page, baseURL!, 1920, 'v6', 'light')
  await commands.click()
  await expectAnchored(page, commands, panel)
  await page.screenshot({ path: testInfo.outputPath('commands-light-desktop.png') })
  await page.setViewportSize({ width: 1024, height: 900 })
  await commands.press('ArrowDown')
  await expectAnchored(page, commands, panel)
  await page.screenshot({ path: testInfo.outputPath('commands-light-1024.png') })
  await page.setViewportSize({ width: 1023, height: 900 })
  await browse.click()
  await page.screenshot({ path: testInfo.outputPath('browse-light-1023.png') })
  await page.keyboard.press('Escape')
  await assertMockApiComplete(page, lightMocks)

  await reviewAppearance(page, testInfo.outputPath('appearance-light-open.png'))
  await assertMockApiComplete(page, lightMocks)
  console.log('Navigation screenshots:', join(testInfo.outputDir, '*.png'))
})

for (const theme of ['dark', 'light'] as const) {
test(`phone Driving shortcuts, inline groups, direct search and pins preserve both entry points (${theme})`, async ({ page, baseURL }, testInfo) => {
  testInfo.setTimeout(180_000)
  const browse = page.getByRole('button', { name: 'Browse sections' })
  const sheet = page.getByRole('dialog', { name: 'Browse sections' })
  const tab = page.getByRole('navigation', { name: 'Quick navigation' }).getByRole('button', { name: 'Driving', exact: true })
  const quick = sheet.getByRole('region', { name: 'Quick access' })
  const filter = sheet.getByRole('searchbox', { name: 'Filter Driving pages' })
  const openDriving = async (pack: 'v6' | 'classic') => {
    if (pack === 'classic') await tab.click()
    else {
      await browse.click()
      await sheet.getByRole('button', { name: 'Driving', exact: true }).click()
    }
    await expect(sheet.getByRole('heading', { name: 'Driving', exact: true })).toBeFocused()
    await expect(filter).not.toBeFocused()
  }
  const contained = async () => {
    await expect(sheet).toBeInViewport({ ratio: 1 })
    expect(await sheet.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
    expect(await sheet.locator('.horizontal-nav-sheet-body').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
    for (const link of await quick.getByRole('link').all()) {
      await expect(link).toBeInViewport({ ratio: 1 })
      await expect(link).toHaveCSS('font-size', '16px')
      expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44)
    }
    await expect(filter).toBeInViewport({ ratio: 1 })
    await expect(sheet.getByRole('button', { name: /Edit pins|Done/ })).toBeInViewport({ ratio: 1 })
  }

    const mocks = await openNavigation(page, baseURL!, 390, 'v6', theme)
    // Pin feedback must expire normally rather than retain the review fixture's frozen clock.
    await page.clock.setSystemTime(new Date())
    for (const pack of ['v6', 'classic'] as const) {
      if (pack === 'classic') await selectReviewPack(page, pack)
      await openDriving(pack)
      const groupIds = await sheet.locator('.horizontal-nav-sheet-group > button')
        .evaluateAll(buttons => buttons.map(button => button.getAttribute('data-nav-choice')))
      const expectedPages = groupIds.flatMap(primary => {
        const collection = COLLECTION_DEFINITIONS.find(candidate => candidate.primary === primary)
        expect(collection).toBeDefined()
        return collection?.paths ?? []
      }).sort()
      await expect(sheet).toHaveCSS('border-bottom-left-radius', '0px')
      if (pack === 'v6') {
        await expect.poll(() => sheet.evaluate(node => {
          const { borderTopLeftRadius, borderTopRightRadius } = getComputedStyle(node)
          return parseFloat(borderTopLeftRadius) > parseFloat(borderTopRightRadius)
        })).toBe(true)
      }
      await expect(quick.getByRole('link')).toHaveCount(3)
      await contained()
      await page.screenshot({ path: testInfo.outputPath(`mobile-${pack}-${theme}-390.png`) })
      await page.setViewportSize({ width: 320, height: 844 })
      await contained()
      await page.screenshot({ path: testInfo.outputPath(`mobile-${pack}-${theme}-320.png`) })
      await page.setViewportSize({ width: 390, height: 900 })

      const records = sheet.getByRole('button', { name: /^Drive records/ })
      await expect(records).toHaveAttribute('aria-expanded', 'false')
      await records.click()
      await expect(records).toHaveAttribute('aria-expanded', 'true')
      const recordPages = sheet.getByRole('region', { name: 'Drive records', exact: true })
      await expect(recordPages.getByRole('link')).toHaveCount(5)
      await expect(recordPages.getByRole('link', { name: 'Drive compare', exact: true })).toBeVisible()
      await expect(sheet.getByRole('heading', { name: 'Driving', exact: true })).toBeVisible()
      await expect(filter).toBeInViewport({ ratio: 1 })
      await page.screenshot({ path: testInfo.outputPath(`mobile-${pack}-${theme}-inline-390.png`) })
      for (const group of await sheet.locator('.horizontal-nav-sheet-group > button').all()) {
        if (await group.getAttribute('aria-expanded') === 'false') await group.click()
      }
      const reachablePages = await sheet.locator('.horizontal-nav-sheet-group a')
        .evaluateAll(links => links.map(link => new URL((link as HTMLAnchorElement).href).pathname).sort())
      expect(reachablePages).toEqual(expectedPages)
      await filter.fill('no-such-navigation-page')
      await expect(sheet.getByRole('status')).toContainText('No pages match')
      await expect(sheet.getByRole('link')).toHaveCount(0)
      await filter.clear()
      await expect(records).toHaveAttribute('aria-expanded', 'true')
      await records.click()
      await expect(recordPages.getByRole('link')).toHaveCount(0)

      await sheet.getByRole('button', { name: 'Edit pins' }).click()
      const pin = recordPages.getByRole('button', { name: 'Drive compare', exact: true })
      await expect(pin).toHaveAttribute('aria-pressed', 'false')
      await pin.click()
      await expect(pin).toHaveAttribute('aria-pressed', 'true')
      await expect.poll(() => mocks.navPins.some(item => item.item_id === '/drive-compare')).toBe(true)
      await expect(pin).toBeFocused()
      await page.setViewportSize({ width: 320, height: 844 })
      await contained()
      await page.screenshot({ path: testInfo.outputPath(`mobile-${pack}-${theme}-pins-320.png`) })
      await page.setViewportSize({ width: 390, height: 900 })
      await sheet.getByRole('button', { name: 'Done' }).click()
      await sheet.getByRole('button', { name: 'Close', exact: true }).click()
      await expect(pack === 'classic' ? tab : browse).toBeFocused()
      await openDriving(pack)
      await expect(quick.getByRole('link', { name: 'Drive compare', exact: true })).toBeVisible()
      await sheet.getByRole('button', { name: 'Edit pins' }).click()
      await pin.click()
      await expect(pin).toHaveAttribute('aria-pressed', 'false')
      await expect(pin).toBeFocused()
      await expect.poll(() => mocks.navPins.some(item => item.item_id === '/drive-compare')).toBe(false)
      await sheet.getByRole('button', { name: 'Done' }).click()
      await expect(quick.getByRole('link', { name: 'Drive compare', exact: true })).toHaveCount(0)

      await sheet.getByRole('button', { name: 'Close', exact: true }).focus()
      await page.keyboard.press('Shift+Tab')
      await expect(sheet.getByRole('button', { name: 'Edit pins' })).toBeFocused()
      await page.keyboard.press('Tab')
      await expect(sheet.getByRole('button', { name: 'Close', exact: true })).toBeFocused()
      await page.keyboard.press('Escape')
      await expect(sheet).toHaveCount(0)
      await expect(pack === 'classic' ? tab : browse).toBeFocused()

      // Exactly two taps from a bottom tab: Driving, then a direct page link.
      for (const [label, path] of [['Drives', '/drives'], ['Drive calendar', '/drive-calendar'], ['Explorer', '/explorer']]) {
        await openDriving(pack)
        const link = quick.getByRole('link', { name: new RegExp(`^${label}\\b`) })
        await expect(link).toHaveAttribute('href', path)
        await link.click()
        await expect.poll(() => new URL(page.url()).pathname).toBe(path)
        await expect(sheet).toHaveCount(0)
        await expect(page.locator('main h1')).toBeVisible()
      }
      await openDriving(pack)
      await filter.fill('calendar')
      await expect(sheet.getByRole('heading', { name: 'Drive records', exact: true })).toBeVisible()
      const result = sheet.getByRole('link', { name: 'Drive calendar', exact: true })
      await expect(result).toHaveAttribute('href', '/drive-calendar')
      await page.screenshot({ path: testInfo.outputPath(`mobile-${pack}-${theme}-search-390.png`) })
      await filter.press('ArrowDown')
      await expect(result).toBeFocused()
      await result.press('Enter')
      await expect.poll(() => new URL(page.url()).pathname).toBe('/drive-calendar')
      await expect(sheet).toHaveCount(0)

      await browse.press('Space')
      const driving = sheet.getByRole('button', { name: 'Driving', exact: true })
      await driving.click()
      await sheet.getByRole('button', { name: /^Drive records/ }).click()
      await sheet.getByRole('button', { name: 'Back', exact: true }).click()
      await expect(driving).toBeFocused()
      await page.keyboard.press('Escape')
      await expect(browse).toBeFocused()
    }
    await assertMockApiComplete(page, mocks)
  console.log('Mobile navigation screenshots:', join(testInfo.outputDir, 'mobile-*.png'))
})
}
