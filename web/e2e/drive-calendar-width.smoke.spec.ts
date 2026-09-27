import { expect, test } from '@playwright/test'
import { installApiMocks, seedBrowserState, waitForHarnessReady } from './mockApi'

test('selected period fills the calendar content width on desktop', async ({ page }) => {
  await seedBrowserState(page, 'dark', '/drive-calendar')
  const mocks = await installApiMocks(page)
  await page.goto('/drive-calendar?from=2026-06-01&to=2026-09-27&time_scope=custom')
  await waitForHarnessReady(page, mocks)

  const heatmap = page.getByRole('img', { name: /Daily driving heatmap for the selected period/i })
  await expect(heatmap).toBeVisible()
  const activity = page.getByRole('region', { name: 'Driving activity' })
  const [heatmapBox, activityBox, lastDayBox] = await Promise.all([
    heatmap.boundingBox(),
    activity.boundingBox(),
    heatmap.locator('[title]').last().boundingBox(),
  ])
  expect(heatmapBox).not.toBeNull()
  expect(activityBox).not.toBeNull()
  expect(lastDayBox).not.toBeNull()
  expect(heatmapBox!.width).toBeGreaterThanOrEqual(activityBox!.width * 0.95)
  expect(lastDayBox!.x + lastDayBox!.width).toBeGreaterThanOrEqual(activityBox!.x + activityBox!.width - 48)
})
