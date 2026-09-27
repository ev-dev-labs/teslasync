import { expect, test } from '@playwright/test'
import { installApiMocks, seedBrowserState } from './mockApi'

for (const width of [390, 1440]) {
  test(`Alert Studio template filters wrap and remain usable at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    await seedBrowserState(page, 'light', '/notifications/studio')
    await installApiMocks(page)
    await page.goto('/notifications/studio', { waitUntil: 'domcontentloaded' })
    await page.getByRole('button', { name: 'Templates' }).click()

    const filters = page.getByRole('group', { name: 'Filter templates by category' })
    await expect(filters.getByRole('button', { name: /All \(\d+\)/ })).toHaveAttribute('aria-pressed', 'true')
    await expect.poll(() => filters.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
    await expect(page.getByRole('searchbox', { name: 'Search templates' })).toBeVisible()

    await filters.getByRole('button', { name: /Battery \(\d+\)/ }).click()
    await expect(filters.getByRole('button', { name: /Battery \(\d+\)/ })).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByText(/\d+ of \d+ templates/)).toBeVisible()
    const screenshot = testInfo.outputPath('template-filters.png')
    await page.screenshot({ path: screenshot })
    await testInfo.attach('template-filters', { path: screenshot, contentType: 'image/png' })
  })
}
