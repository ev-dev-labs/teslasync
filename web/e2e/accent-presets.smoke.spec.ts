import { expect, test } from '@playwright/test'
import { fulfillApiMock, installApiMocks, mockAppSettings, seedBrowserState, waitForHarnessReady } from './mockApi'
import { expectNoHorizontalOverflow } from './qualityAssertions'

for (const width of [390, 1280]) {
  for (const mode of ['dark', 'light'] as const) {
    test(`expanded accent presets and custom color persist at ${width}px in ${mode}`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 900 })
      await seedBrowserState(page, mode, '/settings')
      const api = await installApiMocks(page, 'populated', mode)
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

      await page.goto('/settings#appearance', { waitUntil: 'domcontentloaded' })
      await waitForHarnessReady(page, api)
      const appearance = page.locator('#appearance')
      const accents = appearance.getByRole('group', { name: 'Accent color' })
      await expect(accents.getByRole('button')).toHaveCount(21)
      await expectNoHorizontalOverflow(page)
      const paletteHeight = await accents.evaluate(element => element.getBoundingClientRect().height)
      await page.setViewportSize({ width, height: Math.max(900, Math.ceil(paletteHeight + 700)) })
      await accents.screenshot({
        path: testInfo.outputPath(`expanded-palette-${mode}-${width}.png`),
        animations: 'disabled',
      })
      await page.setViewportSize({ width, height: 900 })

      const ocean = accents.getByRole('button', { name: 'Teal', exact: true })
      await ocean.click()
      await expect(ocean).toHaveAttribute('aria-pressed', 'true')
      await expect.poll(() => settings.theme).toBe('ocean-teal')
      await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--theme-primary').trim())).toBe('#14b8a6')

      await page.reload({ waitUntil: 'domcontentloaded' })
      await waitForHarnessReady(page, api)
      await expect(ocean).toHaveAttribute('aria-pressed', 'true')
      await accents.getByRole('button', { name: 'Custom', exact: true }).click()
      await appearance.getByLabel('Accent', { exact: true }).fill('#8e3abb')
      await expect.poll(() => settings.custom_primary).toBe('#8e3abb')
      await expect.poll(() => settings.theme).toBe('custom')

      await ocean.click()
      await expect.poll(() => settings.theme).toBe('ocean-teal')
      await accents.getByRole('button', { name: 'Custom', exact: true }).click()
      await expect(appearance.getByLabel('Accent', { exact: true })).toHaveValue('#8e3abb')
      await expectNoHorizontalOverflow(page)
    })
  }
}
