import { expect, test } from '@playwright/test'
import { installApiMocks, seedBrowserState, waitForHarnessReady } from './mockApi'

for (const width of [390, 1440]) {
  test(`status overview stays focused at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await seedBrowserState(page, 'light', '/system-status')
    const mockApi = await installApiMocks(page, 'populated')
    await page.goto('/system-status', { waitUntil: 'domcontentloaded' })
    await waitForHarnessReady(page, mockApi)

    await expect(page.getByRole('heading', { name: 'System Status' })).toBeVisible()
    await expect(page.getByRole('region', { name: 'Current component status' })).toBeVisible()
    await expect(page.getByRole('region', { name: 'Recent incidents' })).toBeVisible()
    const details = page.locator('#operator-details')
    await expect(details).not.toHaveAttribute('open')
    await expect(details.getByText('Resources', { exact: true })).not.toBeVisible()
    await expect(page.getByText('80.00%')).toHaveCount(0)

    await details.locator('summary').click()
    await expect(details).toHaveAttribute('open', '')
    await expect(details.getByText('Resources', { exact: true })).toBeVisible()
  })
}
