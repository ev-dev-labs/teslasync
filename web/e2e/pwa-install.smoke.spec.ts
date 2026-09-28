import { devices, expect, test } from '@playwright/test'
import { installApiMocks, seedBrowserState, waitForHarnessReady } from './mockApi'

test.use({ ...devices['Pixel 7'] })

test('Android install offer calls the native prompt on tap', async ({ page }) => {
  await seedBrowserState(page, 'dark', '/')
  const mocks = await installApiMocks(page)
  await page.goto('/')
  await waitForHarnessReady(page, mocks)

  await page.evaluate(() => {
    const event = new Event('beforeinstallprompt', { cancelable: true })
    Object.assign(event, {
      prompt: () => {
        document.documentElement.dataset.installCalls = '1'
        return Promise.resolve()
      },
      userChoice: Promise.resolve({ outcome: 'accepted' }),
    })
    window.dispatchEvent(event)
  })

  await expect(page.getByTestId('install-prompt-install')).toBeVisible()
  await page.getByTestId('install-prompt-install').click()
  await expect(page.locator('html')).toHaveAttribute('data-install-calls', '1')
  await expect(page.getByTestId('install-prompt')).toHaveCount(0)
})
