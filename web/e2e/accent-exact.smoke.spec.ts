import { expect, test, type Locator, type Page } from '@playwright/test'
import type { ThemeId } from '../src/components/ui/ThemeProvider'
import { fulfillApiMock, installApiMocks, mockAppSettings, seedBrowserState, waitForHarnessReady, type MockApiController } from './mockApi'

// Each preset has exactly one source hex; the app must apply it unchanged.
// `custom` resolves to the mocked settings' custom_primary.
const SELECTIONS: ReadonlyArray<{ id: ThemeId; hex: string }> = [
  { id: 'neon-cyan', hex: '#3b82f6' },
  { id: 'tesla-red', hex: '#ef4444' },
  { id: 'matrix-green', hex: '#22c55e' },
  { id: 'royal-purple', hex: '#8b5cf6' },
  { id: 'solar-amber', hex: '#f59e0b' },
  { id: 'sky-blue', hex: '#0ea5e9' },
  { id: 'ocean-teal', hex: '#14b8a6' },
  { id: 'emerald-green', hex: '#10b981' },
  { id: 'forest-green', hex: '#16a34a' },
  { id: 'lime-green', hex: '#84cc16' },
  { id: 'sunny-yellow', hex: '#eab308' },
  { id: 'sunset-orange', hex: '#f97316' },
  { id: 'coral', hex: '#fb7185' },
  { id: 'rose-pink', hex: '#ec4899' },
  { id: 'magenta', hex: '#d946ef' },
  { id: 'lavender', hex: '#a78bfa' },
  { id: 'indigo', hex: '#6366f1' },
  { id: 'navy-blue', hex: '#1e40af' },
  { id: 'gold', hex: '#ca8a04' },
  { id: 'slate-gray', hex: '#64748b' },
  { id: 'custom', hex: '#00b4d8' },
]

function rgb(hex: string): string {
  const value = Number.parseInt(hex.slice(1), 16)
  return `rgb(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255})`
}

async function appliedAccent(page: Page) {
  return page.evaluate(() => {
    const token = getComputedStyle(document.documentElement).getPropertyValue('--theme-primary').trim().toLowerCase()
    // The production primary variant paints `bg-[var(--theme-primary)]`.
    const button = Array.from(document.querySelectorAll<HTMLElement>('button, a'))
      .find((element) => element.className.includes('bg-[var(--theme-primary)]') && element.offsetParent !== null)
    return { token, background: button ? getComputedStyle(button).backgroundColor : null }
  })
}

async function expectColor(locator: Locator, property: string, hex: string) {
  await expect(locator).toBeVisible()
  await expect(locator).toHaveCSS(property, rgb(hex))
}

async function statusColors(page: Page) {
  return page.evaluate(() => {
    const style = getComputedStyle(document.documentElement)
    return ['--semantic-info', '--semantic-activity', '--semantic-update', '--semantic-success', '--semantic-warning', '--semantic-danger']
      .map(token => style.getPropertyValue(token).trim())
  })
}

async function installApiKeyFixture(page: Page, api: MockApiController | null) {
  await page.route('**/api/v1/api-keys', async route => {
    if (route.request().method() !== 'GET') return route.fallback()
    await fulfillApiMock(route, api, {
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([{
        id: 'demo-key',
        name: 'Demo integration',
        key_prefix: 'demo_1234',
        permissions: 'read',
        created_at: '2026-01-01T00:00:00Z',
        last_used_at: null,
        expires_at: null,
      }]),
    })
  })
}

async function expectSelectedRailIconOutsideFades(page: Page) {
  const icon = await page.locator('.sidenav-rail-item.is-selected .sidenav-icon').boundingBox()
  expect(icon).not.toBeNull()
  const top = page.getByTestId('rail-fade-top')
  if (await top.getAttribute('data-visible') === 'true') {
    const fade = await top.boundingBox()
    expect(icon!.y, 'selected accent must not be faded at the top').toBeGreaterThanOrEqual(fade!.y + fade!.height - 1)
  }
  const bottom = page.getByTestId('rail-fade-bottom')
  if (await bottom.getAttribute('data-visible') === 'true') {
    const fade = await bottom.boundingBox()
    expect(icon!.y + icon!.height, 'selected accent must not be faded at the bottom').toBeLessThanOrEqual(fade!.y + 1)
  }
}

for (const mode of ['dark', 'light'] as const) {
  for (const { id, hex } of SELECTIONS) {
    test(`applies the exact ${id} accent ${hex} in ${mode} mode`, async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 })
      await seedBrowserState(page, mode, '/api-keys')
      await page.addInitScript((themeId) => localStorage.setItem('teslasync-theme', themeId), id)
      const api = await installApiMocks(page, 'populated', mode, 'comfortable', id)
      await installApiKeyFixture(page, api)
      // "Create key" is a static primary action on this route.
      await page.goto('/api-keys', { waitUntil: 'domcontentloaded' })
      await waitForHarnessReady(page, api)

      await expect(page.getByText('Demo integration')).toBeVisible()
      await expect.poll(async () => (await appliedAccent(page)).token).toBe(hex)
      await expect.poll(async () => (await appliedAccent(page)).background, { message: 'a visible primary button' }).not.toBeNull()
      expect((await appliedAccent(page)).background).toBe(rgb(hex))
      await expectSelectedRailIconOutsideFades(page)

      const screenshotDir = process.env.THEME_SCREENSHOT_DIR
      if (screenshotDir) {
        await page.screenshot({ path: `${screenshotDir}/${mode}-${id}-navigation-header.png`, animations: 'disabled' })
        await page.goto('/settings#appearance', { waitUntil: 'domcontentloaded' })
        await waitForHarnessReady(page, api)
        const picker = page.locator('#appearance')
        await expect(picker).toBeVisible()
        await picker.screenshot({ path: `${screenshotDir}/${mode}-${id}-picker.png`, animations: 'disabled' })
      }
    })
  }

  test(`switches accents consistently across real controls in ${mode} mode`, async ({ page }) => {
    test.setTimeout(180_000)
    await page.setViewportSize({ width: 1440, height: 900 })
    await seedBrowserState(page, mode, '/settings')
    const api = await installApiMocks(page, 'populated', mode)
    await installApiKeyFixture(page, api)
    let settings = { ...mockAppSettings, mode }
    await page.route('**/api/v1/settings', async route => {
      if (route.request().method() === 'PUT') {
        settings = { ...settings, ...route.request().postDataJSON() }
      }
      await fulfillApiMock(route, api, {
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(settings),
      })
    })
    await page.route('**/api/v1/users/me/activity*', async route => {
      await fulfillApiMock(route, api, {
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([{
          id: 1,
          ts: new Date().toISOString(),
          action: 'drive.completed',
          entity_type: 'drive',
          entity_id: '123',
          detail: null,
        }]),
      })
    })

    await page.goto('/settings#appearance', { waitUntil: 'domcontentloaded' })
    await waitForHarnessReady(page, api)
    const semantic = await statusColors(page)
    const selections = [
      { name: 'Red', id: 'tesla-red', hex: '#ef4444' },
      { name: 'Green', id: 'matrix-green', hex: '#22c55e' },
      { name: 'Custom', id: 'custom', hex: '#8e3abb' },
    ] as const

    for (const selection of selections) {
      const picker = page.locator('#appearance')
      await picker.getByRole('button', { name: selection.name, exact: true }).click()
      if (selection.id === 'custom') {
        await picker.getByLabel('Accent', { exact: true }).fill(selection.hex)
      }
      await expect.poll(async () => (await appliedAccent(page)).token).toBe(selection.hex)
      await expect.poll(() => settings.theme).toBe(selection.id)
      if (selection.id === 'custom') {
        await expect.poll(() => settings.custom_primary).toBe(selection.hex)
      }
      expect(await statusColors(page)).toEqual(semantic)

      await expectColor(page.locator('.sidenav-brand svg'), 'color', selection.hex)
      await expectColor(page.locator('.sidenav-rail-item.is-selected .sidenav-icon'), 'background-color', selection.hex)
      await page.getByRole('button', { name: 'More appearance options' }).click()
      const enabledToggle = page.getByTestId('statusbar-toggle-enabled').getByRole('switch')
      await expect(enabledToggle).toHaveAttribute('aria-checked', 'true')
      await expectColor(enabledToggle.locator('> span'), 'background-color', selection.hex)
      await page.keyboard.press('Tab')
      await enabledToggle.focus()
      await expectColor(enabledToggle, 'outline-color', selection.hex)

      await page.goto('/api-keys', { waitUntil: 'domcontentloaded' })
      await waitForHarnessReady(page, api)
      const primary = page.getByRole('button', { name: /create key/i }).first()
      await expectColor(primary, 'background-color', selection.hex)
      const onAccent = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--theme-on-accent').trim())
      await expectColor(primary, 'color', onAccent)
      await primary.hover()
      await expectColor(primary, 'background-color', selection.hex)
      await page.mouse.down()
      await expectColor(primary, 'background-color', selection.hex)
      await page.mouse.up()

      await page.goto('/explore', { waitUntil: 'domcontentloaded' })
      await waitForHarnessReady(page, api)
      await expectColor(page.getByTestId('explore-anchor-strip').locator('[aria-pressed="true"]'), 'background-color', selection.hex)

      await page.goto('/me/activity', { waitUntil: 'domcontentloaded' })
      await waitForHarnessReady(page, api)
      const activityLink = page.locator('a[href="/drives/123"]').first()
      await expectColor(activityLink, 'color', selection.hex)

      await page.goto('/drives', { waitUntil: 'domcontentloaded' })
      await waitForHarnessReady(page, api)
      const drivingFilter = page.getByTestId('command-deck-secondary').getByRole('searchbox', { name: 'Filter Driving pages' })
      if (!(await drivingFilter.isVisible())) {
        await page.getByTestId('command-deck-rail').getByRole('button', { name: 'Driving', exact: true }).click()
      }
      await drivingFilter.fill('Drives')
      const activeRowIndicator = page.locator('.sidenav-page-row:has(a[href="/drives"][aria-current="page"]) > span[aria-hidden="true"]').first()
      await expectColor(activeRowIndicator, 'background-color', selection.hex)
      expect(await statusColors(page)).toEqual(semantic)

      await page.goto('/settings#appearance', { waitUntil: 'domcontentloaded' })
      await waitForHarnessReady(page, api)
    }

    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/api-keys', { waitUntil: 'domcontentloaded' })
    await waitForHarnessReady(page, api)
    const activeTab = page.locator('.sidenav-phone-tab.is-selected')
    await expect(activeTab).toBeVisible()
    expect(await activeTab.evaluate(element => getComputedStyle(element, '::before').backgroundColor)).toBe(rgb(selections[2].hex))
    if (process.env.THEME_SCREENSHOT_DIR) {
      await page.screenshot({
        path: `${process.env.THEME_SCREENSHOT_DIR}/${mode}-custom-mobile.png`,
        animations: 'disabled',
      })
    }
  })
}
