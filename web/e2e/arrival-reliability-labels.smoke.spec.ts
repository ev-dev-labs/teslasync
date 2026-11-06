import { expect, test } from '@playwright/test';
import {
  closeMockedPage, fulfillApiFixture, installApiMocks, mockDrive,
  seedBrowserState, waitForHarnessReady,
} from './mockApi';

const drives = Array.from({ length: 10 }, (_, route) =>
  Array.from({ length: 3 }, (_, sample) => {
    const start = Date.UTC(2026, 7, 23 - sample, 8 + route);
    const duration = 1_800 + route * 120 + sample * 60;
    return {
      ...mockDrive,
      id: route * 3 + sample + 1,
      start_ts: new Date(start).toISOString(),
      end_ts: new Date(start + duration * 1_000).toISOString(),
      duration_s: duration,
      start_address: `${1200 + route} Northwest Cedar Grove Boulevard, Springfield`,
      end_address: `${3400 + route} Southeast Meadowbrook Business Park, Springfield`,
      start_lat: 37.4 + route * 0.02,
      end_lat: 37.7 + route * 0.02,
    };
  }),
).flat();

for (const theme of ['light', 'dark'] as const) {
  for (const width of [390, 768, 1440, 2560]) {
    test(`arrival route labels remain readable at ${width}px ${theme}`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.clock.setFixedTime(new Date('2026-08-26T16:00:00Z'));
      await seedBrowserState(page, theme, '/arrival-reliability');
      const mocks = await installApiMocks(page, 'populated', theme);
      if (!mocks) throw new Error('Arrival label checks require local API mocks');
      await page.route('**/api/v1/drives?*', route => fulfillApiFixture(route, mocks, { json: drives }));
      await page.goto('/arrival-reliability');
      await waitForHarnessReady(page, mocks);
      await page.evaluate(() => document.fonts.ready.then(() => undefined));

      for (const id of ['arrival-consistency-chart', 'arrival-timing-bands']) {
        const chart = page.getByTestId(id);
        const ticks = chart.locator('.arrival-route-tick');
        await expect(ticks).toHaveCount(10);
        const labels = await ticks.evaluateAll(elements => elements.map(element => {
          const box = element.getBoundingClientRect();
          return { left: box.left, right: box.right, top: box.top, bottom: box.bottom, width: box.width };
        }));
        const bounds = await chart.boundingBox();
        expect(bounds).not.toBeNull();
        for (const [index, label] of labels.entries()) {
          expect(label.width).toBeLessThanOrEqual(145);
          expect(label.left).toBeGreaterThanOrEqual(bounds!.x);
          expect(label.right).toBeLessThanOrEqual(bounds!.x + bounds!.width);
          if (index > 0) expect(label.top - labels[index - 1].bottom).toBeGreaterThanOrEqual(4);
        }
        const fullRoute = await ticks.first().locator('title').textContent();
        await chart.locator('.recharts-bar-rectangle').first().hover();
        const tooltip = chart.getByRole('tooltip');
        await expect(tooltip).toContainText(fullRoute!);
        const tooltipBounds = await tooltip.boundingBox();
        expect(tooltipBounds!.x).toBeGreaterThanOrEqual(bounds!.x);
        expect(tooltipBounds!.x + tooltipBounds!.width).toBeLessThanOrEqual(bounds!.x + bounds!.width);
        expect(await tooltip.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
        await page.mouse.move(0, 0);
        await chart.screenshot({ path: testInfo.outputPath(`${id}-${width}-${theme}.png`), animations: 'disabled' });
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await closeMockedPage(page, mocks);
    });
  }
}
