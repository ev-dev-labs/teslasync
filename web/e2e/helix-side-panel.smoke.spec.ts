import { expect, test } from '@playwright/test'
import {
  installApiMocks,
  resolveApiFixture,
  seedBrowserState,
  waitForHarnessReady,
} from './mockApi'

for (const width of [390, 1440]) {
  test(`Helix side chat shares only opted-in page context at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    await seedBrowserState(page, 'light', '/drives')
    const mocks = await installApiMocks(page)
    const fixture = resolveApiFixture('/settings', 'GET', 'populated', 'light')
    if (!fixture.matched || !fixture.body || typeof fixture.body !== 'object') {
      throw new Error('Settings fixture is unavailable')
    }
    const settings = {
      ...fixture.body as Record<string, unknown>,
      ai_mode: 'local',
      ai_features: { 'chatbot-llm': true },
    }
    await page.route('**/api/v1/settings', route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(settings) }),
    )
    const requests: Array<Record<string, unknown>> = []
    await page.route('**/api/v1/ai/chatbot', async route => {
      requests.push(route.request().postDataJSON() as Record<string, unknown>)
      await route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
        body: 'event: delta\ndata: {"text":"Your drives are shown here."}\n\nevent: done\ndata: {"finish_reason":"stop","usage":{"in":12,"out":7}}\n\n',
      })
    })
    await page.goto('/drives', { waitUntil: 'domcontentloaded' })
    await waitForHarnessReady(page, mocks)
    await page.getByRole('button', { name: 'Open Helix chat' }).click()
    const panel = page.getByRole(width < 1280 ? 'dialog' : 'complementary', { name: 'Helix chat' })
    await expect(panel).toBeVisible()
    const close = panel.getByRole('button', { name: width < 1280 ? 'Close' : 'Close Helix chat', exact: true }).first()
    await expect(close.locator('svg')).toBeVisible()
    await expect(close).toHaveText('')
    const screenshotPath = testInfo.outputPath(`helix-dock-${width}.png`)
    await page.screenshot({ path: screenshotPath })
    await testInfo.attach('helix-dock', { path: screenshotPath, contentType: 'image/png' })
    await panel.getByRole('textbox', { name: 'Ask Helix' }).fill('Explain this view')
    await panel.getByRole('button', { name: 'Send' }).click()
    await expect(panel.getByText('Your drives are shown here.')).toBeVisible()
    expect(requests[0]?.page_context).toMatchObject({ path: '/drives' })
    expect((requests[0]?.page_context as { text: string }).text).toContain('Drives')
    await panel.getByRole('switch', { name: 'Include visible page text' }).click()
    await panel.getByRole('textbox', { name: 'Ask Helix' }).fill('What else?')
    await panel.getByRole('button', { name: 'Send' }).click()
    await expect.poll(() => requests.length).toBe(2)
    expect(requests[1]).not.toHaveProperty('page_context')
  })
}
