import { expect, test } from '@playwright/test';
import { DRIVE_DETAIL_ID, installDriveDetailMocks } from './driveDetailFixtures';
import {
  assertMockApiComplete, fulfillApiFixture, installApiMocks, mockDrive,
  seedBrowserState, waitForHarnessReady,
} from './mockApi';
import { expectNoHorizontalOverflow, monitorPage } from './qualityAssertions';

const path = `/drives/${DRIVE_DETAIL_ID}/replay`;
test.skip(process.env.E2E_MOCKS === '0', 'Requires synthetic recorded replay samples');

for (const theme of ['light', 'dark'] as const) {
  for (const width of [390, 1440]) {
    test(`replay stage and playback remain aligned at ${width}px in ${theme}`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: width === 390 ? 900 : 1100 });
      await seedBrowserState(page, theme, path);
      const mocks = await installApiMocks(page, 'populated', theme);
      await installDriveDetailMocks(page, theme, mocks);
      const diagnostics = monitorPage(page);
      await page.goto(path);
      await waitForHarnessReady(page, mocks);
      const stage = page.getByRole('region', { name: 'Route map and live position' });
      const map = stage.getByTestId('trip-replay-map');
      const stats = stage.getByTestId('replay-current-stats');
      const slider = stage.getByRole('slider', { name: 'Playback progress' });
      await expect(map).toBeVisible();
      await expect(stats).toBeVisible();
      await expect(stats.locator('[data-print-card]')).toHaveCount(0);
      await expect(page.getByRole('region', { name: 'Drive Summary' }).locator('[data-print-card]')).toHaveCount(0);
      const mapBox = await map.boundingBox();
      const statsBox = await stats.boundingBox();
      expect(mapBox).not.toBeNull();
      expect(statsBox).not.toBeNull();
      if (width === 1440) {
        expect(Math.abs(mapBox!.y - statsBox!.y)).toBeLessThan(2);
        expect(Math.abs(mapBox!.height - statsBox!.height)).toBeLessThan(2);
      } else {
        expect(statsBox!.y).toBeGreaterThanOrEqual(mapBox!.y + mapBox!.height - 2);
        const playbackBox = await stage.locator('[data-tour="drive-replay-scrubber"]').boundingBox();
        expect(playbackBox!.y).toBeCloseTo(mapBox!.y + mapBox!.height, 0);
        expect(statsBox!.y).toBeGreaterThan(playbackBox!.y);
      }
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: testInfo.outputPath('replay-overview.png'), fullPage: true });
      await stage.scrollIntoViewIfNeeded();
      await page.screenshot({ path: testInfo.outputPath('replay-stage.png'), fullPage: true });

      await stage.getByRole('button', { name: 'Play', exact: true }).click();
      await expect(stage.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
      await stage.getByRole('button', { name: 'Pause', exact: true }).click();
      await stage.getByRole('button', { name: 'Playback speed: 1x', exact: true }).click();
      await expect(stage.getByRole('button', { name: 'Playback speed: 10x', exact: true })).toBeVisible();
      await slider.focus();
      // Slider keyboard seeking follows sample timestamps, not pixel offsets.
      await slider.press('End');
      await expect(slider).toHaveAttribute('aria-valuenow', '100');
      await expect(stats).toContainText('68%');
      const routeSegment = map.locator('.leaflet-overlay-pane path.leaflet-interactive').first();
      await routeSegment.click({ force: true });
      await expect(slider).not.toHaveAttribute('aria-valuenow', '100');
      await stage.getByRole('button', { name: 'Reset', exact: true }).click();
      await expect(slider).toHaveAttribute('aria-valuenow', '0');
      await expect(stats).toContainText('78%');
      const sliderBox = await slider.boundingBox();
      await slider.click({ position: { x: sliderBox!.width / 2, y: sliderBox!.height / 2 } });
      await expect(slider).toHaveAttribute('aria-valuenow', '50');
      await expect(stats).toContainText('73%');
      // Page-level frame shortcuts still advance the same map/stats/chart sample.
      await page.locator('h1').click();
      await page.keyboard.press('.');
      await expect(stats).toContainText('71%');
      const chart = page.locator('[data-chart-key="trip-replay-speed-power"]');
      // The chart wrapper exposes a stable key through ChartContainer.
      const timeline = chart.locator('.recharts-wrapper');
      await expect(timeline).toBeVisible();
      const box = await timeline.boundingBox();
      await timeline.click({ position: { x: box!.width * 0.3, y: box!.height * 0.4 } });
      await expect(slider).not.toHaveAttribute('aria-valuenow', '75');
      await page.locator('[data-chart-key="trip-replay-speed-power"]').scrollIntoViewIfNeeded();
      await page.screenshot({ path: testInfo.outputPath('replay-seek.png'), fullPage: true });
      await expectNoHorizontalOverflow(page);
      expect(diagnostics.pageErrors).toEqual([]);
      await assertMockApiComplete(page, mocks);
    });
  }

  for (const width of [390, 1440]) {
  test(`sparse replay shows unknown altitude and power rather than flat zero at ${width}px in ${theme}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: width === 390 ? 900 : 1100 });
    await seedBrowserState(page, theme, path);
    const mocks = await installApiMocks(page, 'populated', theme);
    await installDriveDetailMocks(page, theme, mocks);
    const positions = [0, 1, 2].map(index => ({
      latitude: mockDrive.start_lat + index * 0.01,
      longitude: mockDrive.start_lon + index * 0.01,
      timestamp: new Date(Date.parse(mockDrive.start_ts) + index * 10000).toISOString(),
      speed: null, power: null, elevation: null, battery_level: null,
    }));
    await page.route(`**/api/v1/drives/${DRIVE_DETAIL_ID}`, route => fulfillApiFixture(route, mocks, {
      json: { ...mockDrive, id: DRIVE_DETAIL_ID, positions, telemetry: [] },
    }));
    await page.goto(path);
    await waitForHarnessReady(page, mocks);
    const stats = page.getByTestId('replay-current-stats');
    await expect(stats).not.toContainText('0 kW');
    await expect(stats).not.toContainText('0%');
    await expect(page.getByText('No elevation data available', { exact: true })).toBeVisible();
    await expect(page.getByText('No telemetry data available', { exact: true })).toBeVisible();
    const slider = page.getByRole('slider', { name: 'Playback progress' });
    await slider.focus();
    await slider.press('End');
    await expect(slider).toHaveAttribute('aria-valuenow', '100');
    await expect(stats).toContainText('—');
    await page.screenshot({ path: testInfo.outputPath('replay-sparse.png'), fullPage: true });
    await stats.scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath('replay-sparse-readouts.png'), fullPage: true });
    await page.getByText('No elevation data available', { exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath('replay-sparse-timelines.png'), fullPage: true });
    await expectNoHorizontalOverflow(page);
    await assertMockApiComplete(page, mocks);
  });
  }
}
