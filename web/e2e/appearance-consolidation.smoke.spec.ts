import { expect, test } from '@playwright/test'
import { assertMockApiComplete, installApiMocks, seedBrowserState, waitForHarnessReady } from './mockApi'
import { expectNoHorizontalOverflow } from './qualityAssertions'

for (const width of [390, 1920]) {
  for (const theme of ['dark', 'light'] as const) {
    test(`appearance keeps everyday controls concise at ${width}px in ${theme}`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 900 })
      await seedBrowserState(page, theme, '/settings')
      const api = await installApiMocks(page, 'populated', theme)
      await page.goto('/settings#appearance', { waitUntil: 'domcontentloaded' })
      await waitForHarnessReady(page, api)

      const appearance = page.locator('#appearance')
      await expect(appearance).toBeVisible()
      await expect(appearance.getByText('Display Mode', { exact: true })).toBeVisible()
      await expect(page.getByText('Information density', { exact: true })).toBeVisible()
      const browse = appearance.getByRole('button', { name: /Browse all \d+ modes/ })
      await expect(browse).toHaveAttribute('aria-expanded', 'false')
      await expect(appearance.getByRole('searchbox', { name: 'Search display modes…' })).toHaveCount(0)
      const more = page.getByRole('button', { name: 'More appearance options' })
      await expect(more).toHaveAttribute('aria-expanded', 'false')
      await expect(page.getByRole('radiogroup', { name: 'Chart palette' })).toHaveCount(0)
      await expectNoHorizontalOverflow(page)
      await page.screenshot({ path: testInfo.outputPath(`appearance-${theme}-${width}.png`) })

      await browse.click()
      await expect(appearance.getByRole('searchbox', { name: 'Search display modes…' })).toBeVisible()
      await appearance.getByRole('button', { name: 'Show essential modes' }).click()
      await more.click()
      await expect(page.getByRole('radiogroup', { name: 'Chart palette' })).toBeVisible()
      await expect(page.getByTestId('statusbar-toggle-enabled')).toBeVisible()
      await expectNoHorizontalOverflow(page)
      await assertMockApiComplete(page, api)
    })
  }
}
