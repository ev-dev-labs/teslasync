import { expect, test } from '@playwright/test'
import { assertMockApiComplete, installApiMocks, seedBrowserState, waitForHarnessReady } from './mockApi'
import { expectNoHorizontalOverflow } from './qualityAssertions'

for (const width of [390, 1920]) {
  for (const theme of ['dark', 'light'] as const) {
    test(`typography studio previews and applies fonts at ${width}px in ${theme}`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 900 })
      await seedBrowserState(page, theme, '/settings')
      const api = await installApiMocks(page, 'populated', theme)
      await page.goto('/settings#typography', { waitUntil: 'domcontentloaded' })
      await waitForHarnessReady(page, api)

      const preview = page.getByRole('group', { name: 'Typography preview' })
      await expect(preview).toBeVisible()
      await page.getByRole('textbox', { name: 'Try your own text' }).fill('Road trips & range')
      await expect(preview.locator('p').filter({ hasText: 'Road trips & range' })).toBeVisible()

      const sans = page.getByRole('group', { name: 'UI font' })
      await sans.getByRole('searchbox', { name: 'Search UI font' }).fill('noto')
      await expect(sans.getByRole('button')).toHaveCount(1)
      await expect(sans.locator('[data-preview-font="sans-noto-sans"]')).toHaveCSS('font-family', /Noto Sans/)
      await sans.getByRole('button', { name: /Noto Sans/ }).click()
      await expect(page.locator('html')).toHaveCSS('--font-sans', /Noto Sans/)

      const mono = page.getByRole('group', { name: 'Monospace font' })
      await mono.getByRole('searchbox', { name: 'Search Monospace font' }).fill('inconsolata')
      await expect(mono.getByRole('button')).toHaveCount(1)
      await expect(mono.locator('[data-preview-font="mono-inconsolata"]')).toHaveCSS('font-family', /Inconsolata/)
      await mono.getByRole('button', { name: /Inconsolata/ }).click()
      await expect(page.locator('html')).toHaveCSS('--font-mono', /Inconsolata/)

      await page.getByRole('button', { name: 'High legibility' }).click()
      await expect(page.locator('html')).toHaveCSS('--font-scale', '1.05')
      await expect(sans.getByRole('searchbox', { name: 'Search UI font' })).toHaveValue('')
      await expect(sans.getByRole('button', { name: /Atkinson Hyperlegible/ }))
        .toHaveAttribute('aria-pressed', 'true')
      await expectNoHorizontalOverflow(page)
      await page.screenshot({ path: testInfo.outputPath(`typography-${theme}-${width}.png`) })
      await assertMockApiComplete(page, api)
    })
  }
}
