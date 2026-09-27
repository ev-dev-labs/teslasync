import { expect, test } from '@playwright/test'
import { installApiMocks, seedBrowserState, waitForHarnessReady } from './mockApi'

test('installed mobile navigation opens and follows a sidebar shortcut', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'standalone', { configurable: true, value: true })
  })
  await seedBrowserState(page, 'dark', '/')
  const mocks = await installApiMocks(page)
  await page.goto('/')
  await waitForHarnessReady(page, mocks)

  const sidebar = page.locator('[data-role="sidebar"]')
  await expect(page.getByTestId('install-prompt')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Open sidebar' })).toBeVisible()
  await expect(sidebar).toHaveAttribute('data-sidebar-open', 'false')
  await page.getByRole('button', { name: 'Open sidebar' }).click()
  await expect(sidebar).toHaveAttribute('data-sidebar-open', 'true')
  await expect(sidebar.getByRole('navigation', { name: 'Sections and shortcuts' })).toBeVisible()

  for (const { name, destination } of [
    { name: 'All pages', destination: /\/explore$/ },
    { name: 'Alerts', destination: /\/notifications\/inbox$/ },
    { name: 'Display', destination: /\/settings#appearance$/ },
  ]) {
    await sidebar.getByRole('link', { name }).click()
    await expect(page).toHaveURL(destination)
    await expect(sidebar).toHaveAttribute('data-sidebar-open', 'false')
    await page.getByRole('button', { name: 'Open sidebar' }).click()
    await expect(sidebar).toHaveAttribute('data-sidebar-open', 'true')
  }
})
