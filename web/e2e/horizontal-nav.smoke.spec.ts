import { expect, test, type Page } from '@playwright/test'
import { assertMockApiComplete, closeMockApiFixtures, waitForHarnessReady } from './mockApi'
import { createReviewPreference, installPackReview } from './widget-design-packs.mock'

test.afterAll(async () => { await closeMockApiFixtures() })

async function openNavigation(page: Page, baseURL: string, width: number) {
  const origin = new URL(baseURL).origin
  await page.setViewportSize({ width, height: 900 })
  const preference = { ...createReviewPreference(), pack_id: 'v6' as const, app_wide: true }
  const mocks = await installPackReview(page, 'dark', width, false, [], true, preference, origin)
  await page.goto('/explore', { waitUntil: 'domcontentloaded' })
  await waitForHarnessReady(page, mocks)
  return mocks
}

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
  await assertMockApiComplete(page, mocks)
})

test('the phone sheet drills into the same Driving groups and restores focus on Back and Escape', async ({ page, baseURL }) => {
  const mocks = await openNavigation(page, baseURL!, 390)
  const browse = page.getByRole('button', { name: 'Browse sections' })
  await browse.press('Space')
  const sheet = page.getByRole('dialog', { name: 'Browse sections' })
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
  await assertMockApiComplete(page, mocks)
})
