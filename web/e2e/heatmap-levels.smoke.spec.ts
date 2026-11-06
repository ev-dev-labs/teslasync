import { expect, test } from '@playwright/test';
import { join } from 'node:path';
import { wcagContrast } from 'culori';
import { assertMockApiComplete, fulfillApiFixture, installApiMocks, mockAppSettings, seedBrowserState, waitForHarnessReady } from './mockApi';
import { expectNoHorizontalOverflow } from './qualityAssertions';

const route = '/drive-calendar?from=2026-01-01&to=2026-12-31&time_scope=custom';
const drives = Array.from({ length: 132 }, (_, index) => {
  const date = new Date(Date.UTC(2026, 4, 15 + Math.floor(index * 1.2), index === 0 ? 0 : 12, 30));
  return {
    id: index + 1, vehicleId: 7, startTs: date.toISOString(),
    endTs: new Date(date.getTime() + 1800000).toISOString(),
    distanceM: index === 131 ? 2000000 : (index + 1) * 1000, durationS: 1800,
    startAddress: 'Fixture start', endAddress: 'Fixture end',
  };
});

for (const theme of ['light', 'dark'] as const) {
  for (const width of [390, 1280]) {
    test(`calendar activity remains visible at ${width}px in ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.clock.setFixedTime(new Date('2026-11-05T20:00:00Z'));
      await seedBrowserState(page, theme, route);
      const mocks = await installApiMocks(page, 'populated', theme);
      await page.route('**/api/v1/settings', request => fulfillApiFixture(request, mocks, {
        json: { ...mockAppSettings, tz_display_default: 'user', timezone_user: 'America/Los_Angeles' },
      }));
      await page.route('**/api/v1/drives?*', request => fulfillApiFixture(request, mocks, { json: drives }));
      await page.goto(route);
      await waitForHarnessReady(page, mocks);
      const heatmap = page.getByLabel(/Daily driving heatmap for the selected period/);
      await expect(heatmap).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await heatmap.locator('[title*="May 16, 2026"]').scrollIntoViewIfNeeded();
      await heatmap.evaluate(node => node.scrollIntoView({ block: 'center' }));
      await page.screenshot({
        path: join(process.cwd(), '..', 'docs', 'heatmap', process.env.HEATMAP_CAPTURE_PHASE === 'before' ? 'before' : 'after', `${width}-${theme}.png`),
        fullPage: true,
      });
      const active = heatmap.locator('[data-heatmap-level]:not([data-heatmap-level="0"])');
      await expect(active).toHaveCount(132);
      for (const level of [1, 2, 3, 4]) {
        expect(await heatmap.locator(`[data-heatmap-level="${level}"]`).count()).toBeGreaterThan(20);
      }
      const first = heatmap.locator('[data-date="2026-05-14"]');
      await expect(first).toHaveAttribute('aria-label', /May 14, 2026.*1.*drives/);
      await expect(heatmap.locator('[data-date="2026-01-01"]')).toHaveAttribute('data-heatmap-state', 'unavailable');
      await expect(heatmap.locator('[data-date="2026-12-01"]')).toHaveCount(0);
      const paints = await active.evaluateAll(cells => cells.map(cell => getComputedStyle(cell).backgroundColor));
      const surface = await heatmap.evaluate(node => getComputedStyle(node.closest('[data-card]')!).backgroundColor);
      for (const paint of new Set(paints)) expect(wcagContrast(paint, surface)).toBeGreaterThanOrEqual(3);
      const legend = page.getByLabel('Driving intensity from less to more');
      for (const level of [1, 2, 3, 4]) {
        const cell = heatmap.locator(`[data-heatmap-level="${level}"]`).first();
        const swatch = legend.locator(`[data-heatmap-level="${level}"]`);
        expect(await cell.evaluate(node => getComputedStyle(node).backgroundColor))
          .toBe(await swatch.evaluate(node => getComputedStyle(node).backgroundColor));
      }
      await assertMockApiComplete(page, mocks);
    });
  }
}
