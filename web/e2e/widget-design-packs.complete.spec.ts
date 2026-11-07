import { expect, test } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { WIDGET_REGISTRY } from '../src/features/dashboard/widgets/registry';
import { PACK_APPEARANCES, type PackId } from '../src/features/dashboard/widgets/designPacks/types';
import { assertMockApiComplete, closeMockApiFixtures, waitForHarnessReady } from './mockApi';
import { installPackReview, packNames, selectReviewPack } from './widget-design-packs.mock';
import { writePackReviewGallery } from './widget-design-packs.gallery';
import { batteryReadings } from './dashboardCatalogueBatteryFixtures';
import { drivingReadings, compactDrivingReadings } from './dashboardCatalogueDrivingFixtures';
import { vehicleReadings, compactVehicleReadings } from './dashboardCatalogueVehicleFixtures';
import { assertRemainingContent, geometrySourceIDs, remainingReadings, remainingCompactReadings } from './dashboardCatalogueRemainingFixtures';
import { approvedWidgetIds, installCompleteSignalReview, signalReviewManifest } from './widget-design-packs.signals';

const widgets = WIDGET_REGISTRY.map(widget => [widget.id, widget.name] as const);
if (widgets.length !== 132 || new Set(widgets.map(([id]) => id)).size !== 132
  || widgets.some(([id]) => !approvedWidgetIds.includes(id))) {
  throw new Error('The complete review requires all 132 unique production controllers');
}
signalReviewManifest(new Date().toISOString());
const directory = fileURLToPath(new URL('../test-results/widget-design-packs/complete-review/', import.meta.url));
const captures: string[] = [];
const batches = Array.from({ length: Math.ceil(widgets.length / 18) }, (_, index) => widgets.slice(index * 18, (index + 1) * 18));
const fullReadings: Record<string, RegExp | RegExp[]> = {
  ...remainingReadings, ...batteryReadings, ...drivingReadings, ...vehicleReadings,
};
const smallReadings: Record<string, RegExp | RegExp[]> = {
  ...remainingCompactReadings, ...compactDrivingReadings, ...compactVehicleReadings,
};
smallReadings['signal-catalog'] = /1 signals/;
smallReadings['climate-history'] = /Cabin(?: temperature)?\s*21(?:\.0+)?\s*°C/;
smallReadings['vehicle-access'] = /(?:(?<!\d)1 drivers|Authorized drivers\s*1(?!\d))/;
smallReadings['signal-log'] = /signals\/sec/;
Object.assign(fullReadings, {
  'energy-stats': /Total used\s*12\.0\s*kWh/,
  'energy-flow-animated': /14\.00\s*kW/,
  'power-flow-history': /3\.85\s*kW/,
  'solar-production': /12\.0/,
  'energy-site-info': /13\.50\s*kWh/,
  'wall-connector': /14\.0/,
  'cost-breakdown': /\$110\.00/,
  'cost-forecast': /(?:Next 2 months\s*\$250\.00|\$250\.00\s*Next 2 months)/,
  'security-status': /Locked/,
  'door-window-status': /Closed/,
  'sentry-event-log': /Sentry mode activated/,
  'safety-features': /(?:Active features|Blind spot)/i,
  'safety-history': /(?:1 events|FCW: Medium)/,
  'guard-mode': /Armed/,
  'vehicle-access': /(?:1 drivers|Review driver)/,
  'api-usage': /180/,
  'system-health': /(?:4\/4|2\.4 GB)/,
  'mqtt-status': /3\.5/,
  'telemetry-errors': /(?:Healthy|Recovered historical connection interruption)/,
  'signal-health': /274\/274/,
  'signal-log': /Soc/,
  'signal-catalog': /Soc/,
  'uptime-monitor': /Database\s*OK\s*MQTT\s*OK\s*Tesla API\s*OK\s*Fleet Telemetry\s*OK/,
  'charge-status': /72%/, 'charge-status-live': /72%/,
  'new-signal-explorer': /72\.0\s*%/,
  'new-signal-readiness': /250/,
  'new-unit-context': /Kilometers/,
  'new-cabin-comfort': /Buckled/,
  'new-powershare': /-3\.25/,
  'new-axle-thermal': /1(?:\.0+)?\s*°C/,
  'new-high-voltage': /390(?:\.0+)?\s*V/,
  'new-arrival-energy': /50(?:\.0+)?\s*%/,
  'new-charge-readiness': /Not charging/,
  'new-driver-assist': /Enabled/,
  'new-tire-warnings': /2\.80/,
  'recent-drives': /17\.4(?:0)?/,
  'trip-summary': /Distance\s*17\s*km/,
  'drive-score': /100\/100[\s\S]*180\s*Wh\/km\s*Avg\b/,
  'fsd-weekly': /(?:Reported FSD|Reported supervised-driving distance)\s*21\s*km/,
  'charging-telemetry': /[Pp]ower\s*11\.0\s*kW/,
  'regen-efficiency': [
    /20\s*%\s*Energy recovered/,
    /Total recovered\s*0\.84\s*kWh/,
    /Drive energy\s*4\.20\s*kWh/,
  ],
});
if (widgets.some(([id]) => !fullReadings[id] && !geometrySourceIDs.has(id) && id !== 'dashboard-stats')) {
  throw new Error('Every approved widget needs a source-reading or source-geometry contract');
}

test.beforeAll(async () => { await mkdir(directory, { recursive: true }); });
test.afterAll(async () => {
  await closeMockApiFixtures();
  await writePackReviewGallery(directory, widgets, captures, false);
});

for (const theme of ['dark', 'light'] as const) {
  for (const width of [1440, 390]) {
    for (const [batchIndex, selection] of batches.entries()) {
      test(`all widgets batch ${batchIndex + 1} at ${width}px in ${theme}`, async ({ page }, info) => {
        await page.setViewportSize({ width, height: 1200 });
        const failures: string[] = [];
        page.on('pageerror', error => failures.push(error.message));
        const mocks = await installPackReview(page, theme, width, false, selection, true);
        const now = await page.evaluate(() => new Date(Date.now() - 10_000).toISOString());
        await installCompleteSignalReview(page, mocks, now);
        await page.goto('/');
        await waitForHarnessReady(page, mocks);
        const baseline = await page.evaluate(() => localStorage.getItem('teslasync-dashboards'));
        for (const pack of Object.keys(packNames) as PackId[]) {
          await selectReviewPack(page, pack);
          for (const [id, name] of selection) {
            const panel = page.locator(`[data-widget-id="pack-review-${id}"] > .widget-panel`);
            await panel.scrollIntoViewIfNeeded();
            await expect(panel).toBeVisible();
            await expect(panel.locator('[data-widget-pack]').first()).toHaveAttribute('data-widget-pack', pack);
            await expect(panel).not.toContainText(/Something went wrong|Coming soon|Failed to render/i);
            if (id === 'onboarding-checklist' && pack === 'classic') {
              await assertRemainingContent(panel, id, width, info);
            }
            const reading = width === 390 ? smallReadings[id] ?? fullReadings[id] : fullReadings[id];
            if (id === 'dashboard-stats') {
              await expect(panel, `${name}: actual saved layout count`)
                .toContainText(new RegExp(`Widgets placed\\s*${selection.length}(?![\\d.])`));
            } else if (geometrySourceIDs.has(id)) {
              await assertRemainingContent(panel, id, width, info);
            } else if (reading) {
              for (const expected of [reading].flat()) await expect(panel, `${name}: source reading`).toContainText(expected);
            } else {
              throw new Error('Missing source-reading contract: ' + id);
            }
            if (width === 390 && id === 'signal-log') {
              await expect(panel.getByText('4', { exact: true }), `${name}: rounded source ingest rate`).toBeVisible();
            }
            if (width === 390 && id === 'vehicle-access') {
              if (pack === 'classic') {
                await expect(panel.getByRole('img', { name: 'Mobile access enabled', exact: true })).toBeVisible();
              } else {
                await expect(panel.locator('[data-access-pending-count]')).toHaveText('1');
                await expect(panel).toContainText('Mobile access enabled');
              }
            }
            if (pack !== 'classic') {
              await expect(panel.locator([
                `[data-widget-appearance="${PACK_APPEARANCES[pack]}"]`,
                `[data-instrument-appearance="${PACK_APPEARANCES[pack]}"]`,
                `[data-status-appearance="${PACK_APPEARANCES[pack]}"]`,
                `[data-timeline-appearance="${PACK_APPEARANCES[pack]}"]`,
                `[data-vehicle-hero-pack="${pack}"]`, `[data-battery-gauge-pack="${pack}"]`,
                `[data-line-appearance="${PACK_APPEARANCES[pack]}"]`,
                `[data-tire-appearance="${PACK_APPEARANCES[pack]}"]`,
                `[data-climate-appearance="${PACK_APPEARANCES[pack]}"]`,
                `[data-actions-appearance="${PACK_APPEARANCES[pack]}"]`,
              ].join(',')).first(), `${name}: shared appearance`).toBeVisible();
            }
            expect(await panel.evaluate(element => element.scrollWidth > element.clientWidth + 2),
              `${pack}/${id} horizontal overflow`).toBe(false);
            const file = `${theme}-${width}-${pack}-${id}.png`;
            await panel.screenshot({ path: `${directory}${file}`, animations: 'disabled' });
            captures.push(file);
          }
        }
        expect(failures).toEqual([]);
        expect(mocks.requests.filter(request => request.path.endsWith('/command'))).toEqual([]);
        expect(await page.evaluate(() => localStorage.getItem('teslasync-dashboards'))).toBe(baseline);
        await assertMockApiComplete(page, mocks);
      });
    }
  }
}
