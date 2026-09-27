import { expect, test } from '@playwright/test'
import { assertMockApiComplete, installApiMocks, seedBrowserState, waitForHarnessReady } from './mockApi'
import { expectNoHorizontalOverflow } from './qualityAssertions'

for (const width of [1200, 1920]) {
  test(`charging history uses space below spending at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await seedBrowserState(page, 'dark', '/tesla-charging-history')
    const api = await installApiMocks(page, 'populated', 'dark')
    await page.goto('/tesla-charging-history', { waitUntil: 'domcontentloaded' })
    await waitForHarnessReady(page, api)

    const panel = (title: string) => page.getByText(title, { exact: true }).first()
      .locator('xpath=ancestor::*[@data-print-card][1]')
    const [spending, locations, radar, sessions] = await Promise.all(
      ['Monthly Spending', 'Top Locations', 'Price Radar', 'Charging Sessions']
        .map(async title => panel(title).boundingBox()),
    )
    for (const box of [spending, locations, radar, sessions]) expect(box).not.toBeNull()
    if (width === 1920) {
      expect(sessions!.x).toBeCloseTo(spending!.x, 0)
      expect(radar!.x).toBeGreaterThan(sessions!.x + sessions!.width)
      expect(Math.abs(sessions!.y - radar!.y)).toBeLessThan(2)
      expect(locations!.x).toBeCloseTo(radar!.x, 0)
    } else {
      expect(sessions!.y).toBeGreaterThan(radar!.y + radar!.height)
      expect(sessions!.width).toBeGreaterThan(spending!.width * 0.9)
    }
    await expectNoHorizontalOverflow(page)
    await assertMockApiComplete(page, api)
  })
}
