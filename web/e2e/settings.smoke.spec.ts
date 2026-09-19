import { expect, test } from '@playwright/test'
import { assertMockApiComplete, installApiMocks, seedBrowserState, waitForHarnessReady } from './mockApi'

for (const { width, theme } of [320, 390, 768, 1024, 1440, 1920].flatMap(width =>
  (['dark', 'light'] as const).map(theme => ({ width, theme })))) {
  test(`settings categories stay readable and preserve edits at ${width}px in ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await seedBrowserState(page, theme, '/settings')
    const api = await installApiMocks(page, 'populated', theme)
    const writes: string[] = []
    page.on('request', request => {
      if (request.method() === 'PUT' && new URL(request.url()).pathname === '/api/v1/settings') writes.push(request.url())
    })
    await page.goto('/settings', { waitUntil: 'domcontentloaded' })
    await waitForHarnessReady(page, api)
    const selectCategory = async (id: string, label: RegExp) => {
      if (width < 1024) {
        await page.getByRole('combobox', { name: 'Settings categories', exact: true }).selectOption(id)
      } else {
        await page.getByRole('navigation', { name: 'Settings categories', exact: true }).getByRole('button', { name: label }).click()
      }
    }
    await expect(page.locator('#overview')).toBeVisible()
    await expect(page.locator('#general')).toBeHidden()
    await expect(page.locator('#reset')).toBeHidden()
    const actionCard = page.locator('[data-tour="settings-tour"]')
    const description = actionCard.locator('p')
    const action = actionCard.getByRole('button', { name: /Open Tour Launcher/ })
    const descriptionBox = await description.boundingBox()
    const actionBox = await action.boundingBox()
    expect(descriptionBox).not.toBeNull()
    expect(actionBox).not.toBeNull()
    expect(descriptionBox!.width).toBeGreaterThanOrEqual(180)
    expect(actionBox!.y).toBeGreaterThanOrEqual(descriptionBox!.y + descriptionBox!.height)
    await expect(actionCard.getByRole('heading')).toBeVisible()
    expect(await actionCard.getByRole('heading').evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
    const noOverflow = async () => {
      expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)).toBe(false)
    }
    await noOverflow()
    await selectCategory('general', /Units, language & costs/)
    const distance = page.getByRole('combobox', { name: /^Distance Unit$/i })
    await distance.selectOption('mi')
    await selectCategory('typography', /Fonts & readability/)
    await expect(page.locator('#typography')).toBeVisible()
    await expect(distance).toBeHidden()
    await selectCategory('general', /Units, language & costs/)
    await expect(distance).toHaveValue('mi')
    expect(writes).toEqual([])
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await noOverflow()
    for (const [id, label] of [
      ['appearance', /Appearance & experience/],
      ['workspace', /Workspace/],
      ['reset', /Reset & recovery/],
    ] as const) {
      await selectCategory(id, label)
      await expect(page.locator(`#${id}`)).toBeVisible()
      await noOverflow()
    }
    await assertMockApiComplete(page, api)
  })
}
