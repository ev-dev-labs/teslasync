import { expect, test, type Page } from '@playwright/test'
import { assertMockApiComplete, closeMockApiFixtures, waitForHarnessReady } from './mockApi'
import { createReviewPreference, installPackReview, selectReviewPack } from './widget-design-packs.mock'
import { APPLICATION_DESIGNS } from '../src/components/ui/app-designs/designs'
import type { PackId } from '../src/features/dashboard/widgets/designPacks/types'

test.afterAll(async () => { await closeMockApiFixtures() })

async function openNavigation(page: Page, baseURL: string, width: number, pack: PackId = 'v6') {
  const origin = new URL(baseURL).origin
  await page.setViewportSize({ width, height: 900 })
  const preference = { ...createReviewPreference(), pack_id: pack, app_wide: true }
  const mocks = await installPackReview(page, 'dark', width, false, [], true, preference, origin)
  await page.addInitScript(() => localStorage.setItem('teslasync-deck-panel-open', '0'))
  await page.goto('/explore', { waitUntil: 'domcontentloaded' })
  await waitForHarnessReady(page, mocks)
  return mocks
}

test('all packs keep the Driving secondary aligned and contained at laptop and desktop sizes', async ({ page, baseURL }, testInfo) => {
  testInfo.setTimeout(180_000)
  const mocks = await openNavigation(page, baseURL!, 1440, 'classic')
  const nav = page.getByRole('navigation', { name: 'Primary', exact: true })
  const flyout = page.locator('[data-role="section-flyout"]')
  const rail = page.getByTestId('command-deck-rail')
  const side = page.getByTestId('atlas-panel-secondary')
  for (const [id, design] of Object.entries(APPLICATION_DESIGNS)) {
    const pack = id as PackId
    if (pack !== 'classic') await selectReviewPack(page, pack)
    await expect(page.locator('html')).toHaveAttribute('data-app-design-pack', pack)
    for (const width of [1440, 1024]) {
      await test.step(`${pack} at ${width}×768`, async () => {
        await page.setViewportSize({ width, height: 768 })
        const top = design.navigation === 'top'
        const trigger = (top ? nav : rail).getByRole('button', { name: 'Driving', exact: true })
        if (top) await expect(rail).toHaveCount(0)
        else {
          await expect(side).toHaveCount(0)
          await expect(rail.getByRole('button', { name: 'More', exact: true })).toHaveCount(0)
          await expect(rail.getByRole('button', { name: 'Diagnostics', exact: true })).toHaveCount(1)
        }
        await trigger.press('ArrowDown')
        const panel = top ? flyout : side
        await expect(panel).toBeInViewport({ ratio: 1 })
        await expect(top ? side : flyout).toHaveCount(0)
        await expect(panel.getByRole('searchbox', { name: 'Filter Driving pages' })).toBeVisible()
        if (top) {
          const header = await page.locator('[data-role="horizontal-header"]').boundingBox()
          expect((await panel.boundingBox())!.y).toBeGreaterThanOrEqual(header!.y + header!.height - 1)
          await expect(panel.getByRole('menu', { name: 'Drive records', exact: true })).toBeInViewport({ ratio: 1 })
        } else {
          const railBox = await rail.boundingBox()
          const panelBox = await (width < 1280 ? page.locator('.sidenav-tablet-panel') : panel).boundingBox()
          expect(Math.abs(panelBox!.x - railBox!.x - railBox!.width)).toBeLessThanOrEqual(1)
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

test('horizontal sections fold on resize and the flyout switches groups by keyboard and pointer', async ({ page, baseURL }) => {
  const mocks = await openNavigation(page, baseURL!, 1440)
  const nav = page.getByRole('navigation', { name: 'Primary', exact: true })
  const driving = nav.getByRole('button', { name: 'Driving', exact: true })
  const sectionButtons = nav.locator('[data-horizontal-nav-trigger]')
  await expect(driving).toBeVisible()
  const wideCount = await sectionButtons.count()
  await page.setViewportSize({ width: 1024, height: 540 })
  const more = nav.getByRole('button', { name: 'More', exact: true })
  await expect(more).toBeVisible()
  await expect.poll(() => sectionButtons.count()).toBeLessThan(wideCount)
  await more.press('ArrowDown')
  const overflow = page.getByRole('menu', { name: 'More', exact: true })
  await expect(overflow.getByRole('menuitem').first()).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(more).toBeFocused()

  await driving.press('ArrowDown')
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

  await page.getByRole('searchbox', { name: 'Filter Driving pages' }).fill('Drive DNA')
  await expect(page.getByRole('menuitem', { name: 'Drive DNA', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(driving).toBeFocused()
  await expect(driving).toHaveAttribute('aria-expanded', 'false')

  await selectReviewPack(page, 'deco')
  await expect(page.locator('html')).toHaveAttribute('data-app-design-pack', 'deco')
  await driving.press('ArrowDown')
  const flyout = page.locator('[data-role="section-flyout"]')
  await expect(flyout).toHaveCSS('border-top-style', 'double')
  await page.keyboard.press('Escape')
  await more.press('ArrowDown')
  await expect(overflow).toHaveCSS('border-top-style', 'double')
  await page.keyboard.press('Escape')
  await assertMockApiComplete(page, mocks)
})

test('the phone sheet drills into the same Driving groups and restores focus on Back and Escape', async ({ page, baseURL }) => {
  const mocks = await openNavigation(page, baseURL!, 390)
  const browse = page.getByRole('button', { name: 'Browse sections' })
  await browse.press('Space')
  const sheet = page.getByRole('dialog', { name: 'Browse sections' })
  await expect(sheet).toHaveCSS('border-bottom-left-radius', '0px')
  await expect.poll(() => sheet.evaluate(node => {
    const { borderTopLeftRadius, borderTopRightRadius } = getComputedStyle(node)
    return parseFloat(borderTopLeftRadius) > parseFloat(borderTopRightRadius)
  })).toBe(true)
  const driving = sheet.getByRole('button', { name: 'Driving', exact: true })
  await driving.click()
  const records = sheet.getByRole('button', { name: /^Drive records/ })
  await records.click()
  const drives = sheet.getByRole('link', { name: /^Drives/ })
  await expect(drives).toBeVisible()
  await expect(drives).toHaveCSS('font-size', '16px')
  expect((await drives.boundingBox())!.height).toBeGreaterThanOrEqual(44)
  const back = sheet.getByRole('button', { name: 'Back' })
  await back.click()
  await expect(records).toBeFocused()
  await back.click()
  await expect(driving).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(sheet).toHaveCount(0)
  await expect(browse).toBeFocused()
  await selectReviewPack(page, 'classic')
  await expect(page.locator('html')).toHaveAttribute('data-app-design-pack', 'classic')
  await browse.press('ArrowDown')
  await expect(sheet).toBeVisible()
  await driving.click()
  await records.click()
  await expect(drives).toBeVisible()
  await back.click()
  await expect(records).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(browse).toBeFocused()
  await assertMockApiComplete(page, mocks)
})
