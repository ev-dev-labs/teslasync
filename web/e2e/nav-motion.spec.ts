import { expect, test, type Locator, type Page } from '@playwright/test'
import { seedBrowserState, installApiMocks, waitForHarnessReady } from './mockApi'
const captureRoot = '../docs/nav-motion'
async function ready(page: Page, theme: 'dark' | 'light', width: number) {
  await page.setViewportSize({ width, height: 900 })
  await seedBrowserState(page, theme, '/')
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  const api = await installApiMocks(page, 'populated', theme)
  await page.route('**/api/v1/alerts', route => route.fulfill({ json: [{ id: 901, vehicle_id: 1, type: 'low_battery', severity: 'warning', title: 'Battery alert', message: 'Battery needs charging.', is_read: false, created_at: '2026-10-18T12:00:00Z' }] }))
  await page.goto('/')
  await waitForHarnessReady(page, api)
  return api
}
async function select(item: Locator, page: Page, capture?: string, key?: 'Enter' | 'Space', touch = false) {
  const target = item.locator('[data-nav-motion]')
  // Hold the first real CSS animation frame so CPU scheduling cannot let a
  // short animation finish between separate Playwright protocol round trips.
  await target.evaluate(element => {
    element.setAttribute('data-motion-held', 'false')
    const hold = (event: Event) => {
      if (event.target !== element) return
      element.removeEventListener('animationstart', hold)
      element.getAnimations({ subtree: true }).forEach(animation => animation.pause())
      element.setAttribute('data-motion-held', 'true')
    }
    element.addEventListener('animationstart', hold)
  })
  if (key) { await item.focus(); await page.keyboard.press(key) } else if (touch) await item.tap(); else await item.click()
  await expect(target).toHaveAttribute('data-motion-held', 'true')
  await expect(target).toHaveClass(/is-animating/)
  const timings = await target.evaluate(element => element.getAnimations({ subtree: true }).map(animation => {
    const timing = animation.effect!.getTiming()
    return { duration: Number(timing.duration), delay: timing.delay, iterations: timing.iterations }
  }))
  const avatar = await target.locator('[data-nav-icon=avatar]').count()
  expect(timings.length).toBeGreaterThanOrEqual(avatar ? 1 : 2)
  for (const timing of timings) { expect(timing.duration + timing.delay).toBeLessThanOrEqual(avatar ? 400 : 450); expect(timing.iterations).toBe(1) }
  if (capture) {
    await target.evaluate(element => element.getAnimations({ subtree: true }).forEach(animation => { animation.pause(); animation.currentTime = 140 }))
    await page.screenshot({ path: `${captureRoot}/${capture}.png` })
  }
  await target.evaluate(element => element.getAnimations({ subtree: true }).forEach(animation => animation.play()))
  await expect(target).not.toHaveClass(/is-animating/)
  await expect.poll(() => target.evaluate(element => element.getAnimations({ subtree: true }).length)).toBe(0)
  expect(await target.locator('svg').evaluate(element => [...element.querySelectorAll('g'), element].every(part => getComputedStyle(part).transform === 'none'))).toBe(true)
}
for (const theme of ['dark', 'light'] as const) {
  test(`${theme} desktop every section and utility is one shot, replayable, and static on restore`, async ({ page }) => {
    const api = await ready(page, theme, 1280)
    const rail = page.getByTestId('command-deck-rail')
    await expect(rail.locator('.is-animating')).toHaveCount(0)
    const items = rail.locator('.sidenav-rail-item')
    expect(await items.count()).toBe(22)
    for (let index = 0; index < await items.count(); index++) {
      const item = items.nth(index)
      await expect(item.locator('svg')).toHaveCSS('overflow', 'visible')
      const id = await item.locator('svg').getAttribute('data-nav-icon')
      await select(item, page, ['home', 'inbox', 'settings', 'diagnostics'].includes(id!) ? `${theme}-1280-${id}-frame` : undefined)
      const panel = page.getByTestId('atlas-panel-secondary')
      if (await panel.isVisible()) {
        await expect(panel.locator('svg').first()).toHaveAttribute('data-nav-icon', id!)
        await expect(panel.locator('.is-animating, [data-nav-motion]')).toHaveCount(0)
      }
    }
    const inbox = rail.getByRole('button', { name: 'Notifications', exact: true })
    await expect(inbox).toHaveText('Inbox')
    await select(inbox, page, undefined, 'Enter')
    await select(inbox, page, undefined, 'Space')
    await expect(rail.locator('.lucide-bell-ring, .lucide-bell')).toHaveCount(1)
    const bell = rail.getByRole('link', { name: 'Alerts', exact: true })
    await bell.hover()
    await expect(page.getByRole('tooltip', { name: 'Alerts', exact: true })).toBeVisible()
    await expect(bell.locator('.sidenav-alert-count')).toBeVisible()
    await select(bell, page, `${theme}-1280-alerts-frame`)
    await select(rail.getByRole('button', { name: 'Open theme picker', exact: true }), page, `${theme}-1280-display-frame`)
    await page.keyboard.press('Escape')
    const account = rail.locator('summary')
    await select(account, page)
    await page.keyboard.press('Escape')
    await page.reload(); await waitForHarnessReady(page, api)
    await expect(rail.locator('.is-animating')).toHaveCount(0)
    await page.screenshot({ path: `${captureRoot}/${theme}-1280-resting.png` })
  })
  test.describe(`${theme} phone`, () => {
    test.use({ hasTouch: true })
    test(`${theme} every phone tab uses shared choreography; sheet icons stay static`, async ({ page }) => {
      const api = await ready(page, theme, 375)
      const tabs = page.getByRole('navigation', { name: 'Quick navigation' })
      await expect(tabs.locator('.is-animating')).toHaveCount(0)
      await page.screenshot({ path: `${captureRoot}/${theme}-375-tabs-resting.png` })
      for (const name of ['Home', 'Vehicles', 'Driving', 'Charging', 'More']) {
        await select(tabs.getByRole('button', { name, exact: true }), page, undefined, undefined, true)
        const sheet = page.getByRole('dialog')
        await expect(sheet).toBeVisible()
        await expect(sheet.locator('.is-animating, [data-nav-motion]')).toHaveCount(0)
        if (name === 'More') {
          const inbox = sheet.getByRole('button', { name: 'Notifications', exact: true })
          await expect(inbox.locator('svg')).toHaveAttribute('data-nav-icon', 'inbox')
          await inbox.click()
          await expect(sheet.getByRole('searchbox')).toHaveAttribute('placeholder', 'Filter Notifications…')
          await expect(sheet.locator('svg').first()).toHaveAttribute('data-nav-icon', 'inbox')
          await page.screenshot({ path: `${captureRoot}/${theme}-375-inbox-sheet-static.png` })
        }
        await page.keyboard.press('Escape')
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375)
      await page.reload(); await waitForHarnessReady(page, api)
      await expect(page.getByRole('dialog')).toHaveCount(0)
      await expect(tabs.locator('.is-animating')).toHaveCount(0)
    })
  })
}
test('press feedback and live reduced-motion preference disable all motion', async ({ page }) => {
  await ready(page, 'dark', 1280)
  const item = page.getByTestId('command-deck-rail').getByRole('button', { name: 'Home', exact: true })
  const icon = item.locator('[data-nav-motion]')
  await item.hover(); await page.mouse.down()
  await expect.poll(() => icon.evaluate(element => getComputedStyle(element).transform)).toBe('matrix(0.9, 0, 0, 0.9, 0, 0)')
  await page.mouse.up()
  await expect(icon).toHaveClass(/is-animating/)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await expect(icon).not.toHaveClass(/is-animating/)
  await item.hover(); await page.mouse.down()
  expect(await icon.evaluate(element => getComputedStyle(element).transform)).toBe('none')
  await page.mouse.up()
  await expect(icon).not.toHaveClass(/is-animating/)
  expect(await icon.evaluate(element => element.getAnimations({ subtree: true }).length)).toBe(0)
})
