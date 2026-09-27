import { expect, test } from '@playwright/test';
import { assertMockApiComplete, installApiMocks, seedBrowserState, waitForHarnessReady } from './mockApi';
import { expectNoHorizontalOverflow } from './qualityAssertions';

for (const [width, range, compact] of [
  [1920, 'from=2026-07-01&to=2026-09-13', true],
  [1920, 'from=2025-01-01&to=2025-12-31', false],
  [390, 'from=2026-07-01&to=2026-09-13', true],
] as const) {
  test(`drive calendar activity fits ${width}px with ${compact ? 'short' : 'year-long'} period`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await seedBrowserState(page, 'light', '/drive-calendar');
    const mockApi = await installApiMocks(page, 'populated', 'light');
    await page.goto(`/drive-calendar?${range}`, { waitUntil: 'domcontentloaded' });
    await waitForHarnessReady(page, mockApi);

    const activity = page.getByRole('region', { name: 'Driving activity' });
    const [heatmap, monthly, weekday] = await Promise.all(
      [0, 1, 2].map((index) => activity.locator('[data-print-card]').nth(index).boundingBox()),
    );
    const bounds = await activity.boundingBox();
    expect(heatmap).not.toBeNull();
    expect(monthly).not.toBeNull();
    expect(weekday).not.toBeNull();
    expect(bounds).not.toBeNull();
    if (compact) {
      const dayCells = activity.getByRole('img', { name: /Daily driving heatmap/ }).locator('[title]');
      expect(await dayCells.count()).toBeGreaterThan(0);
      expect(await dayCells.evaluateAll(cells => cells.some(cell => /[1-9]\d* drives/.test(cell.getAttribute('title') ?? ''))))
        .toBe(true);
    }

    if (width === 1920 && compact) {
      expect(heatmap!.width).toBeLessThan(bounds!.width * 0.4);
      expect(monthly!.x).toBeGreaterThan(heatmap!.x + heatmap!.width);
      expect(weekday!.x).toBeGreaterThan(monthly!.x + monthly!.width);
      expect(Math.abs(heatmap!.y - monthly!.y)).toBeLessThan(2);
      expect(Math.abs(heatmap!.y - weekday!.y)).toBeLessThan(2);
    } else if (width === 1920) {
      expect(heatmap!.width).toBeGreaterThan(bounds!.width * 0.9);
      expect(monthly!.y).toBeGreaterThan(heatmap!.y + heatmap!.height);
    } else {
      expect(monthly!.y).toBeGreaterThan(heatmap!.y + heatmap!.height);
      expect(weekday!.y).toBeGreaterThan(monthly!.y + monthly!.height);
    }
    await expectNoHorizontalOverflow(page);
    await assertMockApiComplete(page, mockApi);
  });
}
