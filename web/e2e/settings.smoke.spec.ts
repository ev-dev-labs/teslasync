import { expect, test } from '@playwright/test'
import { assertMockApiComplete, installApiMocks, seedBrowserState, waitForHarnessReady } from './mockApi'

for (const { width, theme, scale } of [320, 390, 768, 1024, 1280, 1440, 1920, 2560].flatMap(width =>
  (['dark', 'light'] as const).flatMap(theme => [1, 1.35].map(scale => ({ width, theme, scale }))))) {
  test(`settings categories stay readable and preserve edits at ${width}px in ${theme} with ${scale}x text`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    await seedBrowserState(page, theme, '/settings')
    const api = await installApiMocks(page, 'populated', theme)
    const writes: string[] = []
    page.on('request', request => {
      if (request.method() === 'PUT' && new URL(request.url()).pathname === '/api/v1/settings') writes.push(request.url())
    })
    await page.goto('/settings', { waitUntil: 'domcontentloaded' })
    await waitForHarnessReady(page, api)
    await page.evaluate(scale => document.documentElement.style.setProperty('--font-scale', String(scale)), scale)
    await expect(page.locator('html')).toHaveCSS('--font-scale', String(scale))
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
    const shortcutCards = page.getByRole('region', { name: 'Settings shortcuts', exact: true }).locator('[data-print-card]')
    await expect(shortcutCards).toHaveCount(3)
    for (const [index, card] of (await shortcutCards.all()).entries()) {
      const paragraph = card.locator('p')
      const box = await paragraph.boundingBox()
      expect(box!.width).toBeGreaterThanOrEqual(180)
      const button = card.getByRole('button')
      if (await button.count()) {
        const buttonBox = await button.boundingBox()
        expect(buttonBox!.y).toBeGreaterThanOrEqual(box!.y + box!.height)
        expect(buttonBox!.height).toBeGreaterThanOrEqual(44)
        await button.click({ trial: true })
      }
      await card.scrollIntoViewIfNeeded()
      await card.screenshot({ path: testInfo.outputPath(`settings-shortcut-${index + 1}.png`) })
    }
    const categoryDescription = page.getByText('Current preferences and useful shortcuts', { exact: true }).filter({ visible: true }).last()
    const saveHint = page.getByText('Each section keeps its existing save controls. Switching categories keeps your unsaved edits.', { exact: true })
    const categoryBox = await categoryDescription.boundingBox()
    const hintBox = await saveHint.boundingBox()
    expect(hintBox!.y).toBeGreaterThanOrEqual(categoryBox!.y + categoryBox!.height)
    const overflowText = await page.locator('#overview [data-print-card]').evaluateAll(cards => cards.flatMap(card => {
      const bounds = card.getBoundingClientRect()
      const walker = document.createTreeWalker(card, NodeFilter.SHOW_TEXT)
      const overflow: string[] = []
      while (walker.nextNode()) {
        const node = walker.currentNode
        if (!node.textContent?.trim()) continue
        const range = document.createRange()
        range.selectNodeContents(node)
        if ([...range.getClientRects()].some(rect => rect.left < bounds.left || rect.right > bounds.right + 1)) {
          overflow.push(node.textContent)
        }
      }
      return overflow
    }))
    expect(overflowText, 'Overview text must fit inside its card, not clip or spill into adjacent cards').toEqual([])
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
