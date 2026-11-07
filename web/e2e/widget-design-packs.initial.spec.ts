import { expect, test } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { PackId } from '../src/features/dashboard/widgets/designPacks/types';
import { assertMockApiComplete, closeMockApiFixtures, fulfillApiFixture, waitForHarnessReady } from './mockApi';
import {
  reviewWidgets, installPackReview, packNames, presentationSelector, selectReviewPack,
} from './widget-design-packs.mock';
import { batteryReadings } from './dashboardCatalogueBatteryFixtures';
import { drivingReadings } from './dashboardCatalogueDrivingFixtures';
import { vehicleReadings } from './dashboardCatalogueVehicleFixtures';
import { writePackReviewGallery } from './widget-design-packs.gallery';

const instrumentReadings: Record<string, RegExp | readonly RegExp[]> = {
  ...batteryReadings, ...drivingReadings, ...vehicleReadings,
  'drive-score': [/100\/100/, /180\s*Wh\/km\s*Avg\b/],
  'regen-efficiency': [/20\s*%/, /Total recovered\s*0\.84\s*kWh/, /Drive energy\s*4\.20\s*kWh/],
  'charge-status': /72/, 'charge-status-live': /72/,
  'signal-health': /10\/10/, 'notification-stats': /90/, 'fleet-posture': /1/,
  'energy-stats': /12\.0/, 'range-estimate': /410\s*km/,
  'live-signals': /InsideTemp/, 'live-signal-sparklines': /Battery Level/,
  'drivetrain-health': /Healthy/, 'motor-performance': /240/,
  'vehicle-specs': /Long Range/, 'safety-features': /Forward collision warning/,
  'guard-mode': /Armed/, 'uptime-monitor': /Fleet Telemetry/,
  'system-health': /Healthy/, 'automation-status': /Catalogue cabin routine/,
  'backup-monitor': /2\.0(?:0)?\s*MB/, 'version-info': /catalogue-2026\.10/,
  'energy-site-info': /Self-Powered/, 'charge-cost-tracker': /\$6\.72/,
  'fleet-stats': /300\s*km/, 'fleet-stats-bar': /300\s*km/,
  'lifetime-stats': /1,234\s*km/, 'mileage-stats': /10\s*km/,
  'year-review': /1,234\s*km/, 'analytics-summary': /300\s*km/,
  'dashboard-stats': /Widgets placed/,
  'alert-feed': /Catalogue battery threshold/, 'sentry-event-log': /Sentry mode activated/,
  'backup-history': /30m/, 'command-history': /Flash lights/i,
  'audit-log': /Catalogue settings updated/, 'automation-history': [/Catalogue cabin routine/, /Succeeded/, /1\.3\s*s/],
  'telemetry-errors': /review_resolved/, 'media-history': /Catalogue evening drive/,
  'safety-history': /FCW/, 'signal-log': [/Soc/, /72/, /71/],
  'supercharger-history': /\$12\.00/, 'charge-plans': /80\.00%/,
  'charging-schedule': /80%/, 'export-status': /Running/,
  'charging-optimizer': /80(?:\.00)?\s*%/, 'next-charge-decision': /Catalogue low-rate window starts soon/,
  'anomaly-detector': /InsideTemp/, 'recently-unlocked-achievements': /Catalogue first trip/,
};

const reviewDirectory = fileURLToPath(new URL('../test-results/widget-design-packs/review/', import.meta.url));
const captures: string[] = [];
test.beforeAll(async () => { await mkdir(reviewDirectory, { recursive: true }); });
test.afterAll(async () => {
  await closeMockApiFixtures();
  await writePackReviewGallery(reviewDirectory, reviewWidgets, captures);
});

for (const theme of ['dark', 'light'] as const) {
  for (const width of [1440, 390]) {
    test(`actual eight-pack renders at ${width}px in ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1200 });
      const failures: string[] = [];
      page.on('pageerror', error => failures.push(error.message));
      const mocks = await installPackReview(page, theme, width);
      await page.goto('/');
      await waitForHarnessReady(page, mocks);
      const baselineWidgets = await page.evaluate(() => JSON.parse(localStorage.getItem('teslasync-dashboards') ?? '[]')[0]?.widgets);
      for (const packId of Object.keys(packNames) as PackId[]) {
        await selectReviewPack(page, packId);
        for (const [id] of reviewWidgets) {
          const panel = page.locator(`[data-widget-id="pack-review-${id}"] > .widget-panel`);
          await expect(panel).toBeVisible();
          await expect(panel.locator('[data-widget-pack]').first()).toHaveAttribute('data-widget-pack', packId);
          if (reviewWidgets.slice(7).some(([widgetId]) => widgetId === id)) {
            const compactReadings: Record<string, RegExp> = {
              'automation-status': /1\/1/, 'uptime-monitor': /4\/4/, 'backup-monitor': /Last backup/,
              'mileage-stats': /10\s*km\/day/,
              'audit-log': /Events \(24h\)/, 'telemetry-errors': /error VINs/,
              'signal-log': /signals\/sec/,
              'export-status': /Active exports/, 'charge-plans': /80/,
              'anomaly-detector': /1 active/,
            };
            const readings = width === 390 && compactReadings[id] ? compactReadings[id] : instrumentReadings[id];
            for (const reading of [readings].flat()) await expect(panel).toContainText(reading);
            if (id === 'dashboard-stats') await expect(panel.getByText(String(reviewWidgets.length), { exact: true })).toBeVisible();
            const compactSourceCounts: Record<string, number> = { 'audit-log': 2, 'telemetry-errors': 0, 'signal-log': 4, 'export-status': 2 };
            if (width === 390 && id in compactSourceCounts) {
              await expect(panel.getByText(String(compactSourceCounts[id]), { exact: true })).toBeVisible();
            }
          }
          if (packId !== 'classic') {
            const presentations = panel.locator(presentationSelector(id, packId));
            const compoundCounts: Record<string, number> = { 'charge-plans': 3, 'maintenance-tracker': 2 };
            await expect(presentations).toHaveCount(id === 'live-signal-sparklines' ? 3
              : width === 1440 ? compoundCounts[id] ?? 1 : 1);
            for (const presentation of await presentations.all()) await expect(presentation).toBeVisible();
          }
          if (packId === 'v7' && (id === 'range-estimate' || (id === 'energy-stats' && width === 1440))) {
            await expect(panel.locator('pattern')).toHaveCount(2);
            const patterns = await panel.locator('pattern').evaluateAll(nodes => nodes.map(node => node.id));
            const fills = await panel.locator('.recharts-bar-rectangle path').evaluateAll(nodes =>
              nodes.map(node => node.getAttribute('fill')));
            expect(fills).toEqual(patterns.map(id => `url(#${id})`));
          }
          if (id === 'warranty-status' && width === 1440 && packId === 'v7') {
            await expect(panel.getByRole('progressbar')).toHaveCount(2);
            expect(await panel.locator('[data-metric-track] > div > span > span').evaluateAll(fills =>
              fills.some(fill => {
                const width = Number.parseFloat((fill as HTMLElement).style.width);
                return width > 0 && width < 100;
              }),
            )).toBe(true);
          }
          if (id === 'drive-telemetry' && width === 1440 && packId !== 'classic') {
            await expect(panel.locator('.recharts-line-curve')).toHaveCount(2);
            await expect.poll(() => panel.locator('.recharts-line-curve').evaluateAll(lines =>
              lines.map(line => line.getAttribute('stroke-dasharray')),
            )).toEqual(packId === 'v7' ? [null, '2 3'] : [null, null]);
          }
          await panel.evaluate(element => element.scrollIntoView({ block: 'center', inline: 'nearest' }));
          const overflow = await panel.evaluate(element => element.scrollWidth > element.clientWidth + 2);
          expect(overflow, `${packId}/${id} horizontal overflow`).toBe(false);
          const file = `${theme}-${width}-${packId}-${id}.png`;
          await panel.screenshot({ path: `${reviewDirectory}${file}`, animations: 'disabled' });
          captures.push(file);
        }
      }
      expect(failures).toEqual([]);
      expect(mocks.requests.filter(request => request.path.endsWith('/command'))).toEqual([]);
      expect(await page.evaluate(() => JSON.parse(localStorage.getItem('teslasync-dashboards') ?? '[]')[0]?.widgets)).toEqual(baselineWidgets);
      await assertMockApiComplete(page, mocks);
    });
  }
}

test('both signal widgets preserve elapsed time and explicit gaps in every named pack', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1200 });
  const mocks = await installPackReview(page, 'dark', 1440);
  const now = await page.evaluate(() => Date.now());
  const readings = [[0, 0], [10, 10], [20, null], [90, 90], [100, 100]] as const;
  await page.route(url => url.pathname === '/api/v1/signals/7/BatteryLevel/history', route =>
    fulfillApiFixture(route, mocks, { json: {
      vehicle_id: 7, signal: 'BatteryLevel', count: readings.length,
      data: readings.map(([seconds, value]) => ({
        ts: new Date(now - 100_000 + seconds * 1000).toISOString(),
        kind: 'ValueKindDouble', value,
      })),
    } }));
  await page.goto('/');
  await waitForHarnessReady(page, mocks);
  for (const pack of Object.keys(packNames).filter(id => id !== 'classic') as Exclude<PackId, 'classic'>[]) {
    await selectReviewPack(page, pack);
    for (const id of ['live-signals', 'live-signal-sparklines']) {
      const panel = page.locator(`[data-widget-id="pack-review-${id}"] > .widget-panel`);
      const plot = panel.getByRole('img', { name: id === 'live-signals' ? 'BatteryLevel trend' : 'Battery Level trend' });
      await expect(plot.locator('polyline[fill="none"]')).toHaveCount(2);
      const positions = await plot.locator('polyline[fill="none"]').evaluateAll(lines =>
        lines.flatMap(line => (line.getAttribute('points') ?? '').split(' ')
          .map(point => Number(point.split(',')[0]))));
      expect(positions).toHaveLength(4);
      expect(positions[0]).toBe(0);
      expect(positions[1] / positions[3]).toBeCloseTo(0.1);
      expect(positions[2] / positions[3]).toBeCloseTo(0.9);
      if (pack === 'v7') {
        const file = `timed-${id}.png`;
        await panel.screenshot({ path: `${reviewDirectory}${file}`, animations: 'disabled' });
        captures.push(file);
      }
    }
  }
  expect(mocks.requests.filter(request => request.path.endsWith('/command'))).toEqual([]);
  await assertMockApiComplete(page, mocks);
});

test('maintenance review stays open across all packs and unknown forecasts do not invent remaining distance', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1200 });
  const mocks = await installPackReview(page, 'dark', 1440);
  await page.goto('/');
  await waitForHarnessReady(page, mocks);
  await selectReviewPack(page, 'v1');
  const panel = page.locator('[data-widget-id="pack-review-maintenance-tracker"] > .widget-panel');
  await expect(panel).toContainText('Review cabin filter');
  await expect(panel).toContainText(/Every 18 mo.*20,000(?:\.00)? km/);
  await expect(panel.getByText(/^20,000(?:\.00)? km$/)).toHaveCount(0);
  const trigger = panel.getByRole('button', { name: 'Review details', exact: true });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Forecast vehicle 7' });
  for (const pack of Object.keys(packNames) as PackId[]) {
    await selectReviewPack(page, pack);
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('Forecast depends on recorded service history and mileage.');
  }
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
  expect(mocks.requests.filter(request => request.path.endsWith('/command'))).toEqual([]);
  await assertMockApiComplete(page, mocks);
});

test('zero and partial instrument observations stay independent in Owner and Pixel', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1200 });
  const mocks = await installPackReview(page, 'dark', 1440, true);
  await page.goto('/');
  await waitForHarnessReady(page, mocks);
  for (const packId of ['v4', 'v7'] as const) {
    await selectReviewPack(page, packId);
    for (const id of ['battery-radial-gauge', 'regen-efficiency', 'battery-health-analytics', 'notification-stats']) {
      const panel = page.locator(`[data-widget-id="pack-review-${id}"] > .widget-panel`);
      await expect(panel.locator(presentationSelector(id, packId))).toBeVisible();
      if (id === 'battery-radial-gauge' || id === 'regen-efficiency') {
        await expect(panel).toContainText('0');
        if (id === 'regen-efficiency') await expect(panel).toContainText('-0.12');
      } else {
        await expect(panel).toContainText('—');
        if (id === 'notification-stats') await expect(panel.getByRole('meter')).toHaveCount(0);
      }
      const file = `partial-${packId}-${id}.png`;
      await panel.screenshot({ path: `${reviewDirectory}${file}`, animations: 'disabled' });
      captures.push(file);
    }
  }
  expect(mocks.requests.filter(request => request.path.endsWith('/command'))).toEqual([]);
  await assertMockApiComplete(page, mocks);
});

test('unknown readings and read-only commands remain honest in the implemented presentation', async ({ page, context }) => {
  await page.setViewportSize({ width: 1440, height: 1200 });
  const mocks = await installPackReview(page, 'dark', 1440, true);
  await page.goto('/');
  await waitForHarnessReady(page, mocks);
  await selectReviewPack(page, 'v4');
  for (const id of ['tire-pressure-visual', 'climate-status', 'security-status', 'command-quick-actions']) {
    const panel = page.locator(`[data-widget-id="pack-review-${id}"] > .widget-panel`);
    await expect(panel.locator(presentationSelector(id, 'v4'))).toBeVisible();
    if (id === 'tire-pressure-visual') {
      await expect(panel.getByRole('group', { name: 'FL', exact: true })).toContainText('0.00');
      await expect(panel.getByRole('group', { name: 'FR', exact: true })).toContainText('—');
      await expect(panel).not.toContainText('All normal');
    } else if (id === 'climate-status') {
      await expect(panel).toContainText('HVAC unknown');
      await expect(panel).toContainText('set —');
    } else if (id === 'security-status') {
      await expect(panel).not.toContainText('All closed');
      await expect(panel).not.toContainText('Unlocked');
    } else {
      await assertMockApiComplete(page, mocks);
      await context.setOffline(true);
      await expect(panel.getByRole('button', { name: 'Unlock', exact: true })).toBeDisabled();
    }
    await panel.evaluate(element => element.scrollIntoView({ block: 'center' }));
    const file = `unknown-${id}.png`;
    await panel.screenshot({ path: `${reviewDirectory}${file}`, animations: 'disabled' });
    captures.push(file);
  }
  expect(mocks.requests.filter(request => request.path.endsWith('/command'))).toEqual([]);
});
