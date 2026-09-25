import { expect, test } from '@playwright/test'
import { installApiMocks, resolveApiFixture, seedBrowserState, waitForHarnessReady } from './mockApi'

for (const width of [390, 1440]) {
  test(`Helix feature explorer can find chat at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    await seedBrowserState(page, 'light', '/integrations/helix')
    const mockApi = await installApiMocks(page)
    const fixture = resolveApiFixture('/settings', 'GET', 'populated', 'light')
    if (!fixture.matched || !fixture.body || typeof fixture.body !== 'object') {
      throw new Error('Settings fixture is unavailable')
    }
    await page.route('**/api/v1/settings', route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ...fixture.body as Record<string, unknown>, ai_mode: 'local' }),
      }),
    )
    await page.goto('/integrations/helix', { waitUntil: 'domcontentloaded' })
    await waitForHarnessReady(page, mockApi)
    const explorer = page.getByTestId('ai-feature-toggle-list')
    await explorer.scrollIntoViewIfNeeded()
    await expect(explorer.getByRole('searchbox', { name: 'Search AI features' })).toBeVisible()
    const screenshotPath = testInfo.outputPath(`helix-features-${width}.png`)
    await page.screenshot({ path: screenshotPath })
    await testInfo.attach('feature-explorer', { path: screenshotPath, contentType: 'image/png' })
    await explorer.getByRole('searchbox', { name: 'Search AI features' }).fill('chat')
    await expect(explorer.getByRole('switch', { name: 'Helix chat (side panel)' })).toBeVisible()
    await expect(explorer.getByRole('status')).toContainText('of')
    await explorer.getByRole('button', { name: /Enabled \(/ }).click()
    await expect(explorer.getByRole('button', { name: /Enabled \(/ })).toHaveAttribute('aria-pressed', 'true')
  })
}

test('Helix usage shows live audited totals instead of placeholder amounts', async ({ page }) => {
  await seedBrowserState(page, 'light', '/integrations/helix')
  const mockApi = await installApiMocks(page)
  const fixture = resolveApiFixture('/settings', 'GET', 'populated', 'light')
  if (!fixture.matched || !fixture.body || typeof fixture.body !== 'object') {
    throw new Error('Settings fixture is unavailable')
  }
  await page.route('**/api/v1/settings', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ...fixture.body as Record<string, unknown>, ai_mode: 'local' }),
    }),
  )
  let usageRequests = 0
  await page.route('**/api/v1/ai/usage/today', route => {
    usageRequests += 1
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        call_count: 3,
        input_tokens: 1250,
        output_tokens: 420,
        cost_micro_cents: 1200,
        error_count: 1,
        avg_latency_ms: 35,
      }),
    })
  })
  await page.goto('/integrations/helix', { waitUntil: 'domcontentloaded' })
  await waitForHarnessReady(page, mockApi)
  const card = page.getByTestId('ai-usage-card')
  await expect(card.getByText('3 calls · 1 error')).toBeVisible()
  await expect(card.getByTestId('ai-usage-value')).toHaveText(['1,250', '420', '$0.001200'])
  expect(usageRequests).toBeGreaterThan(0)
})
