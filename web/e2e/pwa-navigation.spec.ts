import { expect, test } from '@playwright/test'
import { installApiMocks, seedBrowserState, waitForHarnessReady } from './mockApi'

test('installed mobile navigation opens the shared sheet and follows a page', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'standalone', { configurable: true, value: true })
  })
  await seedBrowserState(page, 'dark', '/')
  const mocks = await installApiMocks(page)
  await page.goto('/')
  await waitForHarnessReady(page, mocks)

  const browse = page.getByRole('button', { name: 'Browse sections' })
  const sheet = page.getByRole('dialog', { name: 'Browse sections' })
  await expect(page.getByTestId('install-prompt')).toHaveCount(0)
  await expect(browse).toHaveAttribute('aria-expanded', 'false')
  await browse.click()
  await expect(browse).toHaveAttribute('aria-expanded', 'true')
  await expect(sheet).toBeVisible()

  await sheet.getByRole('button', { name: 'Home', exact: true }).click()
  await sheet.getByRole('searchbox').fill('Explore features')
  await sheet.getByRole('button', { name: /^Pages/ }).click()
  await sheet.getByRole('link', { name: 'Explore features', exact: true }).click()
  await expect(page).toHaveURL(/\/explore$/)
  await expect(sheet).toHaveCount(0)
  await expect(browse).toHaveAttribute('aria-expanded', 'false')

  await browse.click()
  await sheet.getByRole('button', { name: 'Notifications', exact: true }).click()
  await sheet.getByRole('button', { name: /^Notification center/ }).click()
  await sheet.getByRole('link', { name: /^All notifications/ }).click()
  await expect(page).toHaveURL(/\/notifications\/inbox$/)
  await expect(sheet).toHaveCount(0)

  await page.getByRole('button', { name: 'Open theme picker' }).click()
  const appearance = page.getByRole('dialog', { name: 'Open theme picker' })
  await appearance.getByRole('button', { name: 'Customize…' }).click()
  await expect(page).toHaveURL(/\/settings#appearance$/)
  await expect(appearance).toHaveCount(0)
})
