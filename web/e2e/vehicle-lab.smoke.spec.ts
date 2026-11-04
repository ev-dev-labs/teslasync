import { createHash } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { assertMockApiComplete, installApiMocks, seedBrowserState, waitForHarnessReady } from './mockApi'
import { expectNoHorizontalOverflow } from './qualityAssertions'

test.use({ launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] } })

for (const theme of ['light', 'dark'] as const) {
  for (const width of [390, 1280]) {
    test(`vehicle studio renders and changes camera at ${width}px in ${theme}`, async ({ page }) => {
      const errors: string[] = []
      page.on('pageerror', error => errors.push(error.message))
      await page.setViewportSize({ width, height: 900 })
      await seedBrowserState(page, theme, '/experiments/vehicle-lab')
      const mocks = await installApiMocks(page, 'populated', theme)
      await page.goto('/experiments/vehicle-lab')
      await waitForHarnessReady(page, mocks)
      const canvas = page.getByRole('img', { name: /^Illustrative vehicle/ })
      await expect(canvas).toBeVisible()
      const front = createHash('sha256').update(await canvas.screenshot()).digest('hex')
      await page.getByRole('button', { name: 'Rear', exact: true }).click()
      await expect(page.getByRole('button', { name: 'Rear', exact: true })).toHaveAttribute('aria-pressed', 'true')
      await expect.poll(async () => createHash('sha256').update(await canvas.screenshot()).digest('hex')).not.toBe(front)
      await page.getByRole('button', { name: 'Top', exact: true }).focus()
      await page.keyboard.press('Enter')
      await expect(page.getByRole('button', { name: 'Top', exact: true })).toHaveAttribute('aria-pressed', 'true')
      await expectNoHorizontalOverflow(page)
      expect(errors).toEqual([])
      assertMockApiComplete(mocks)
    })
  }
}

test('vehicle studio preserves all signal rows without WebGL', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 })
  await page.addInitScript(() => Object.defineProperty(window, 'WebGL2RenderingContext', { value: undefined }))
  await seedBrowserState(page, 'light', '/experiments/vehicle-lab')
  const mocks = await installApiMocks(page, 'populated', 'light')
  await page.goto('/experiments/vehicle-lab')
  await waitForHarnessReady(page, mocks)
  const studio = page.getByRole('region', { name: 'Vehicle studio' })
  await expect(studio.getByText('3D is unavailable on this device. Every vehicle signal remains readable below.', { exact: true })).toBeVisible()
  await expect(studio.getByRole('region', { name: 'Vehicle state' }).getByText('Unavailable', { exact: true })).toHaveCount(27)
  await expect(studio.getByText('Front-left door', { exact: true })).toBeVisible()
  await expect(studio.getByText('Rear-right tire', { exact: true })).toBeVisible()
  await expect(page.locator('canvas')).toHaveCount(0)
  await expectNoHorizontalOverflow(page)
  assertMockApiComplete(mocks)
})
