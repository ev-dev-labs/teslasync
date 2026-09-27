import { expect, test } from '@playwright/test'
import { expectThemeApplied, installApiMocks, seedBrowserState, waitForHarnessReady } from './mockApi'

for (const theme of ['dark', 'light'] as const) {
  test(`kiosk preview and live widgets use the ${theme} theme`, async ({ page }) => {
    await seedBrowserState(page, theme, '/')
    const mockApi = await installApiMocks(page, 'populated', theme)
    await page.goto('/', { waitUntil: 'domcontentloaded' })
    await waitForHarnessReady(page, mockApi)
    await expectThemeApplied(page, theme)

    await page.getByRole('button', { name: 'More dashboard actions' }).click()
    await page.getByRole('button', { name: 'Kiosk mode' }).click()
    const settings = page.getByRole('dialog', { name: 'Kiosk Settings' })
    await expect(settings).toBeVisible()
    const preview = settings.locator('.kiosk-surface')
    const previewPanel = settings.locator('.kiosk-panel')
    const previewColors = await preview.evaluate(element => ({
      background: getComputedStyle(element).backgroundColor,
      panel: getComputedStyle(element.parentElement!.querySelector('.kiosk-panel')!).backgroundColor,
    }))
    expect(previewColors.background).not.toBe('rgba(10, 10, 20, 1)')
    await expect(previewPanel).toBeVisible()

    await settings.getByRole('button', { name: 'Enter Kiosk Mode' }).click()
    const kiosk = page.locator('.kiosk-root')
    await expect(kiosk).toBeVisible()
    await expect(kiosk.locator('.kiosk-panel').first()).toBeVisible()
    const liveColors = await kiosk.evaluate(element => ({
      background: getComputedStyle(element).backgroundColor,
      panel: getComputedStyle(element.querySelector('.kiosk-panel')!).backgroundColor,
    }))
    expect(liveColors).toEqual(previewColors)

    await page.evaluate(() => document.documentElement.style.setProperty('--bg-app', '#aabbcc'))
    await expect.poll(() => kiosk.evaluate(element => getComputedStyle(element).backgroundColor))
      .not.toBe(liveColors.background)
  })
}
