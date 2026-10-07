import { expect, test, type Download, type Locator, type Page } from '@playwright/test';
import { DRIVE_DETAIL_ID, installDriveDetailMocks } from '../driveDetailFixtures';
import { ROUTE_REGISTRY } from '../../src/lib/routeRegistry';
import {
  assertMockApiComplete, expectThemeApplied, fulfillApiFixture, installApiMocks, mockDrive,
  seedBrowserState, waitForHarnessReady,
} from '../mockApi';
import {
  expectDialogsInsideViewport, expectNoHorizontalOverflow, expectNoRuntimeFailures, monitorPage,
} from '../qualityAssertions';
import {
  installTripFixtures, journeyReport, missingTripDetail, nextPageTrips, TRIP_ID, TRIP_LIST_PATH,
  trips, zeroJourneyReport, zeroTripDetail,
} from './trips.fixtures';

const BRIEF_MARKER = '[data-operational-brief]';
const replayPath = `/drives/${DRIVE_DETAIL_ID}/replay?vehicle_id=7`;
const detailPath = `/trips/${TRIP_ID}?vehicle_id=7`;
const journeysPath = '/journeys?vehicle_id=7';

function metric(brief: Locator, key: string): Locator {
  return brief.locator(`[data-operational-metric="${key}"]`);
}

async function expectMetric(
  brief: Locator, key: string, value: string | RegExp, state: 'value' | 'missing' = 'value',
): Promise<void> {
  const item = metric(brief, key);
  await expect(item).toHaveAttribute('data-value-state', state);
  await expect(item.locator('[data-operational-value]')).toHaveText(value);
}

async function expectRealBrief(page: Page, title: string, count: number): Promise<Locator> {
  const brief = page.getByRole('region', { name: title, exact: true });
  await expect(brief).toHaveAttribute('data-operational-brief', 'true');
  await expect(page.locator(BRIEF_MARKER)).toHaveCount(1);
  await expect(brief.locator('[data-operational-metric]')).toHaveCount(count);
  await expect(brief).toContainText('Source loaded');
  return brief;
}

async function reviewBrief(
  page: Page, brief: Locator, title: string, provenance: string,
): Promise<void> {
  const before = await brief.locator('[data-operational-value]').allTextContents();
  const trigger = brief.getByRole('button', { name: 'Review details', exact: true });
  await trigger.focus();
  await trigger.press('Enter');
  const dialog = page.getByRole('dialog', { name: `${title} details`, exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Operational metrics');
  await expect(dialog).toContainText(provenance);
  await expect(dialog).toContainText('Source loaded');
  for (const value of before) await expect(dialog).toContainText(value);
  await expectDialogsInsideViewport(page);
  await expectNoHorizontalOverflow(page);
  await page.keyboard.press('Tab');
  expect(await dialog.evaluate(node => node.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Shift+Tab');
  expect(await dialog.evaluate(node => node.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  expect(await brief.locator('[data-operational-value]').allTextContents()).toEqual(before);
}

async function downloadText(download: Download): Promise<string> {
  const stream = await download.createReadStream();
  if (!stream) throw new Error('Expected a readable browser download');
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

async function expectPublishedMetricsUnchanged(brief: Locator, values: readonly string[]): Promise<void> {
  expect(await brief.locator('[data-operational-value]').allTextContents()).toEqual(values);
}

for (const theme of ['light', 'dark'] as const) {
  for (const width of [320, 1440]) {
    test.describe(`trip OperationalBrief ${width}px ${theme}`, () => {
      test.beforeEach(async ({ page }) => {
        expect(process.env.E2E_MOCKS, 'Trip contracts require typed synthetic fixtures, not production execution').not.toBe('0');
        for (const path of ['/trips', '/trips/:id', '/drives/:id/replay', '/journeys']) {
          expect(ROUTE_REGISTRY.some(route => route.path === path)).toBe(true);
        }
        await page.setViewportSize({ width, height: 1000 });
      });

      test('loaded trip directory keeps SI totals, page/query qualifiers and original exports', async ({ page }) => {
        await seedBrowserState(page, theme, TRIP_LIST_PATH);
        const mocks = await installApiMocks(page, 'populated', theme);
        await installTripFixtures(page, mocks, theme);
        const diagnostics = monitorPage(page);
        await page.goto(TRIP_LIST_PATH);
        await waitForHarnessReady(page, mocks);
        await expectThemeApplied(page, theme);
        const brief = await expectRealBrief(page, 'Loaded trip summary', 6);
        await expect(brief).toContainText('Loaded page only · 2026-08-01 – 2026-08-26 · vehicle 7');
        await expect(brief).toContainText('not fleet-wide or full-range totals');
        await expectMetric(brief, 'distance', '100 km');
        await expectMetric(brief, 'energy', '12.00 kWh');
        await expectMetric(brief, 'cost', '$20.00');
        await expectMetric(brief, 'trips', '2');
        await expectMetric(brief, 'average-distance', '50 km');
        await expectMetric(brief, 'charges', '3');
        await expect(metric(brief, 'distance')).toContainText('2 trips');
        await expect(metric(brief, 'energy')).toContainText('10 drives');
        await expect(metric(brief, 'trips')).toContainText('10 total drives');
        await expect(metric(brief, 'charges')).toContainText('3 charge sessions');
        await expect(metric(brief, 'cost')).toContainText('$20.00/100km');
        await reviewBrief(page, brief, 'Loaded trip summary',
          'Stored trip records returned by the selected vehicle, date window and pagination.');
        const cards = page.getByRole('region', { name: 'All trips', exact: true });
        await expect(cards.getByText(trips[0].name, { exact: true })).toBeVisible();
        await expect(cards.getByText(trips[1].name, { exact: true })).toBeVisible();
        const chart = page.getByRole('figure', { name: 'Top Trips by Distance', exact: true });
        const csvPromise = page.waitForEvent('download');
        await chart.getByRole('button', { name: 'CSV', exact: true }).click();
        const csv = await csvPromise;
        expect(csv.suggestedFilename()).toBe('teslasync-trips-v2.csv');
        const csvContent = await downloadText(csv);
        expect(csvContent.split('\n')[0]).toBe('id,name,start_date,end_date,distance_m,energy_wh,cost,drives,charges');
        expect(csvContent).toContain(',40000,8000,12,3,1');
        expect(csvContent).toContain(',60000,4000,8,7,2');
        const jsonPromise = page.waitForEvent('download');
        await chart.getByRole('button', { name: 'JSON', exact: true }).click();
        const json = await jsonPromise;
        expect(json.suggestedFilename()).toBe('teslasync-trips.json');
        const records: TripExport[] = JSON.parse(await downloadText(json));
        expect(records.map(row => [row.id, row.total_distance_m, row.total_energy_wh])).toEqual([
          [601, 40_000, 8_000], [602, 60_000, 4_000],
        ]);
        await page.getByRole('navigation', { name: 'Pagination', exact: true })
          .getByRole('button', { name: 'Next page', exact: true }).click();
        await expect.poll(() => new URL(page.url()).searchParams.get('page')).toBe('2');
        await waitForHarnessReady(page, mocks);
        await expectMetric(brief, 'distance', '10 km');
        await expectMetric(brief, 'energy', '2.00 kWh');
        await expectMetric(brief, 'cost', '$2.00');
        await expectMetric(brief, 'trips', '1');
        await expectMetric(brief, 'average-distance', '10 km');
        await expectMetric(brief, 'charges', '0');
        await expect(brief).toContainText('Loaded page only · 2026-08-01 – 2026-08-26 · vehicle 7');
        await expect(cards.getByText(nextPageTrips[0].name, { exact: true })).toBeVisible();
        await expect(cards.getByText(trips[0].name, { exact: true })).toHaveCount(0);
        await expect(cards.getByText(trips[1].name, { exact: true })).toHaveCount(0);
        await expectNoHorizontalOverflow(page);
        await expectNoRuntimeFailures(diagnostics);
        await assertMockApiComplete(page, mocks);
      });

      test('trip record keeps measured totals, drive/charge context and detail sections', async ({ page }) => {
        await seedBrowserState(page, theme, detailPath);
        const mocks = await installApiMocks(page, 'populated', theme);
        await installTripFixtures(page, mocks, theme);
        const diagnostics = monitorPage(page);
        await page.goto(detailPath);
        await waitForHarnessReady(page, mocks);
        await expectThemeApplied(page, theme);
        const brief = await expectRealBrief(page, 'Trip totals', 6);
        await expect(brief).toContainText('Trip #601 · 2026-08-24T08:00:00Z – 2026-08-24T09:00:00Z');
        await expectMetric(brief, 'distance', '40 km');
        await expectMetric(brief, 'energy', '8.00 kWh');
        await expectMetric(brief, 'efficiency', '200 Wh/km');
        await expectMetric(brief, 'duration', '1h');
        await expectMetric(brief, 'drives', '3');
        await expectMetric(brief, 'cost', '$12.00');
        await expect(metric(brief, 'distance')).toContainText('3 drives');
        await expect(metric(brief, 'drives')).toContainText('1 charges');
        await reviewBrief(page, brief, 'Trip totals',
          'Stored trip detail; malformed non-negative totals retain the existing zero-clamp display policy.');
        await expect(page.getByText('Drives in this trip', { exact: true })).toBeVisible();
        for (const route of ['Origin → First stop', 'First stop → Second stop', 'Second stop → Destination']) {
          await expect(page.getByText(route, { exact: true })).toBeVisible();
        }
        await expectNoHorizontalOverflow(page);
        await expectNoRuntimeFailures(diagnostics);
        await assertMockApiComplete(page, mocks);
      });

      test('completed journey debrief keeps distinct report/history/readiness denominators', async ({ page }) => {
        await seedBrowserState(page, theme, journeysPath);
        const mocks = await installApiMocks(page, 'populated', theme);
        await installTripFixtures(page, mocks, theme);
        const diagnostics = monitorPage(page);
        await page.goto(journeysPath);
        await waitForHarnessReady(page, mocks);
        await expectThemeApplied(page, theme);
        const brief = await expectRealBrief(page, 'Journey report summary', 7);
        await expect(brief).toContainText('Journey #701 · 2026-08-24T08:00:00Z – 2026-08-24T09:00:00Z');
        await expectMetric(brief, 'distance', '40.00 km');
        await expectMetric(brief, 'duration', '1.00 h');
        await expectMetric(brief, 'detour', '1.25×');
        await expectMetric(brief, 'fixes', '6');
        await expectMetric(brief, 'replans', '2 of 5 plans');
        await expectMetric(brief, 'usual', '1.10× over 9 trips');
        await expectMetric(brief, 'checklist', '3 of 4');
        await expect(page.getByText(`· ${journeyReport.evidence[0]}`, { exact: true })).toBeVisible();
        await reviewBrief(page, brief, 'Journey report summary',
          'Journey report refreshed by transitions, check-ins and replans; route-history trips have a separate denominator.');
        await expect(page.getByRole('button', { name: 'Re-check', exact: true })).toBeVisible();
        await page.getByRole('button', { name: 'Plan journey', exact: true }).click();
        await expect(page.getByRole('textbox', { name: 'Journey name', exact: true })).toBeVisible();
        await page.getByRole('button', { name: 'Cancel', exact: true }).click();
        await expect(page.getByRole('textbox', { name: 'Journey name', exact: true })).toHaveCount(0);
        await expectMetric(brief, 'checklist', '3 of 4');
        await expectNoHorizontalOverflow(page);
        await expectNoRuntimeFailures(diagnostics);
        await assertMockApiComplete(page, mocks);
      });

      test('replay summary stays independent of playhead and preserves raw SI speed and elevation', async ({ page }) => {
        await seedBrowserState(page, theme, replayPath);
        const mocks = await installApiMocks(page, 'populated', theme);
        await installDriveDetailMocks(page, theme, mocks);
        const diagnostics = monitorPage(page);
        await page.goto(replayPath);
        await waitForHarnessReady(page, mocks);
        await expectThemeApplied(page, theme);
        const brief = await expectRealBrief(page, 'Drive Summary', 8);
        await expect(brief).toContainText(`Drive #${DRIVE_DETAIL_ID}`);
        await expectMetric(brief, 'distance', '28.75 km');
        await expectMetric(brief, 'duration', '32m');
        await expectMetric(brief, 'average-speed', '53.64 km/h');
        await expectMetric(brief, 'maximum-speed', '104.76 km/h');
        await expectMetric(brief, 'efficiency', '178.09 Wh/km');
        await expectMetric(brief, 'battery', '78% → 68%');
        await expect(metric(brief, 'battery')).toContainText('Start 78% → end 68%');
        await expectMetric(brief, 'elevation-gain', '4 m');
        await expectMetric(brief, 'elevation-loss', '0 m');
        const before = await brief.locator('[data-operational-value]').allTextContents();
        const stage = page.getByRole('region', { name: 'Route map and live position', exact: true });
        const slider = stage.getByRole('slider', { name: 'Playback progress', exact: true });
        await slider.focus();
        await slider.press('End');
        await expect(slider).toHaveAttribute('aria-valuenow', '100');
        await expect(stage.getByTestId('replay-current-stats')).toContainText('68%');
        expect(await brief.locator('[data-operational-value]').allTextContents()).toEqual(before);
        await stage.getByRole('button', { name: 'Reset', exact: true }).click();
        await expect(slider).toHaveAttribute('aria-valuenow', '0');
        await reviewBrief(page, brief, 'Drive Summary',
          'Stored drive summary and the loaded, telemetry-enriched GPS trail.');
        await expect(page.getByRole('link', { name: 'Back to Drive', exact: true })).toHaveAttribute('href', `/drives/${DRIVE_DETAIL_ID}`);
        await expectNoHorizontalOverflow(page);
        await expectNoRuntimeFailures(diagnostics);
        await assertMockApiComplete(page, mocks);
      });

      test('successful empty directory is measured zero, not unknown or full-range totals', async ({ page }) => {
        await seedBrowserState(page, theme, TRIP_LIST_PATH);
        const mocks = await installApiMocks(page, 'populated', theme);
        await installTripFixtures(page, mocks, theme, { list: [] });
        await page.goto(TRIP_LIST_PATH);
        await waitForHarnessReady(page, mocks);
        const brief = await expectRealBrief(page, 'Loaded trip summary', 6);
        await expectMetric(brief, 'distance', '0 km');
        await expectMetric(brief, 'energy', '0.00 kWh');
        await expectMetric(brief, 'cost', '$0.00');
        await expectMetric(brief, 'trips', '0');
        await expectMetric(brief, 'average-distance', '0 km');
        await expectMetric(brief, 'charges', '0');
        await expect(brief).toContainText('Loaded page only');
        await expect(page.getByText('No trips recorded yet', { exact: true })).toBeVisible();
        const chart = page.getByRole('figure', { name: 'Top Trips by Distance', exact: true });
        await expect(chart.getByRole('button', { name: 'CSV', exact: true })).toBeDisabled();
        await expect(chart.getByRole('button', { name: 'JSON', exact: true })).toBeDisabled();
        await reviewBrief(page, brief, 'Loaded trip summary',
          'Stored trip records returned by the selected vehicle, date window and pagination.');
        await expectNoHorizontalOverflow(page);
        await assertMockApiComplete(page, mocks);
      });

      test('directory source failure does not invent successful empty-page zeros', async ({ page }) => {
        await seedBrowserState(page, theme, TRIP_LIST_PATH);
        const mocks = await installApiMocks(page, 'populated', theme);
        await installTripFixtures(page, mocks, theme);
        await page.route(url => url.pathname === '/api/v1/trips', route => fulfillApiFixture(route, mocks, {
          status: 404, json: { error: 'Synthetic trip source unavailable' },
        }));
        const diagnostics = monitorPage(page);
        await page.goto(TRIP_LIST_PATH);
        const brief = page.getByRole('region', { name: 'Loaded trip summary', exact: true });
        await expect(brief).toContainText('Source failed', { timeout: 30_000 });
        await waitForHarnessReady(page, mocks);
        await expect(brief).toHaveAttribute('data-operational-brief', 'true');
        for (const key of ['distance', 'energy', 'cost', 'trips', 'average-distance', 'charges']) {
          await expectMetric(brief, key, '—', 'missing');
        }
        await expect(brief).toContainText('Loaded page only');
        expect(diagnostics.pageErrors).toEqual([]);
        expect(diagnostics.brokenResources).toEqual([]);
        expect(diagnostics.failedDataRequests.length).toBeGreaterThan(0);
        expect(diagnostics.failedDataRequests.every(value =>
          value.startsWith('404 fetch ') && value.includes('/api/v1/trips?'))).toBe(true);
        await expectNoHorizontalOverflow(page);
        await assertMockApiComplete(page, mocks);
      });

      test('directory refresh retains published page totals and the complete export/card surface', async ({ page }) => {
        test.setTimeout(60_000);
        await seedBrowserState(page, theme, TRIP_LIST_PATH);
        const mocks = await installApiMocks(page, 'populated', theme);
        await installTripFixtures(page, mocks, theme);
        await page.goto(TRIP_LIST_PATH);
        await waitForHarnessReady(page, mocks);
        const brief = await expectRealBrief(page, 'Loaded trip summary', 6);
        const before = await brief.locator('[data-operational-value]').allTextContents();
        await page.route(url => url.pathname === '/api/v1/trips', route => fulfillApiFixture(route, mocks, {
          status: 404, json: { error: 'Synthetic trip source unavailable during refresh' },
        }));
        await page.locator('main').getByRole('button', { name: /^Refresh data ·/ }).click();
        await expect(brief).toContainText('Retained source', { timeout: 30_000 });
        await expectPublishedMetricsUnchanged(brief, before);
        const cards = page.getByRole('region', { name: 'All trips', exact: true });
        await expect(cards.getByText(trips[0].name, { exact: true })).toBeVisible();
        await expect(cards.getByText(trips[1].name, { exact: true })).toBeVisible();
        const chart = page.getByRole('figure', { name: 'Top Trips by Distance', exact: true });
        await expect(chart.getByRole('button', { name: 'CSV', exact: true })).toBeEnabled();
        const jsonPromise = page.waitForEvent('download');
        await chart.getByRole('button', { name: 'JSON', exact: true }).click();
        const retained: TripExport[] = JSON.parse(await downloadText(await jsonPromise));
        expect(retained.map(row => [row.id, row.total_distance_m, row.total_energy_wh])).toEqual([
          [601, 40_000, 8_000], [602, 60_000, 4_000],
        ]);
        const trigger = brief.getByRole('button', { name: 'Review details', exact: true });
        await trigger.focus();
        await trigger.press('Enter');
        const dialog = page.getByRole('dialog', { name: 'Loaded trip summary details', exact: true });
        await expect(dialog).toContainText('Retained source');
        await expect(dialog).toContainText('not fleet-wide or full-range totals');
        for (const value of before) await expect(dialog).toContainText(value);
        await expectDialogsInsideViewport(page);
        await page.keyboard.press('Escape');
        await expect(trigger).toBeFocused();
        await expectPublishedMetricsUnchanged(brief, before);
        await expectNoHorizontalOverflow(page);
        await assertMockApiComplete(page, mocks);
      });

      for (const sourceCase of ['zero', 'missing'] as const) {
        test(`trip ${sourceCase} totals distinguish measured zeros from unavailable ratios/durations`, async ({ page }) => {
          await seedBrowserState(page, theme, detailPath);
          const mocks = await installApiMocks(page, 'populated', theme);
          await installTripFixtures(page, mocks, theme, {
            detail: sourceCase === 'zero' ? zeroTripDetail : missingTripDetail,
          });
          await page.goto(detailPath);
          await waitForHarnessReady(page, mocks);
          const brief = await expectRealBrief(page, 'Trip totals', 6);
          if (sourceCase === 'zero') {
            await expectMetric(brief, 'distance', '0 km');
            await expectMetric(brief, 'energy', '0.00 kWh');
            await expectMetric(brief, 'drives', '0');
            await expectMetric(brief, 'cost', '$0.00');
          } else {
            for (const key of ['distance', 'energy', 'drives', 'cost']) {
              await expectMetric(brief, key, '—', 'missing');
            }
          }
          await expectMetric(brief, 'efficiency', '—', 'missing');
          await expectMetric(brief, 'duration', '—', 'missing');
          await expect(metric(brief, 'efficiency')).toContainText('Efficiency requires a positive trip distance.');
          await expectNoHorizontalOverflow(page);
          await assertMockApiComplete(page, mocks);
        });
      }

      test('journey zero counters keep source-null multipliers unknown', async ({ page }) => {
        await seedBrowserState(page, theme, journeysPath);
        const mocks = await installApiMocks(page, 'populated', theme);
        await installTripFixtures(page, mocks, theme, { report: zeroJourneyReport });
        await page.goto(journeysPath);
        await waitForHarnessReady(page, mocks);
        const brief = await expectRealBrief(page, 'Journey report summary', 7);
        await expectMetric(brief, 'distance', '0.00 km');
        await expectMetric(brief, 'duration', '0.00 h');
        await expectMetric(brief, 'fixes', '0');
        await expectMetric(brief, 'replans', '0 of 0 plans');
        await expectMetric(brief, 'checklist', '0 of 0');
        await expectMetric(brief, 'detour', '—', 'missing');
        await expectMetric(brief, 'usual', '—', 'missing');
        await expectNoHorizontalOverflow(page);
        await assertMockApiComplete(page, mocks);
      });

      test('sparse replay retains stored totals while unrecorded speed, battery and elevation stay unknown', async ({ page }) => {
        await seedBrowserState(page, theme, replayPath);
        const mocks = await installApiMocks(page, 'populated', theme);
        await installDriveDetailMocks(page, theme, mocks, { partial: true });
        await page.goto(replayPath);
        await waitForHarnessReady(page, mocks);
        const brief = await expectRealBrief(page, 'Drive Summary', 8);
        await expectMetric(brief, 'distance', '28.75 km');
        await expectMetric(brief, 'duration', '32m');
        for (const key of ['average-speed', 'maximum-speed', 'efficiency', 'battery', 'elevation-gain', 'elevation-loss']) {
          await expectMetric(brief, key, '—', 'missing');
        }
        await expect(page.getByText(
          'No GPS data available for this drive. Trip replay requires valid position coordinates from Fleet Telemetry.',
          { exact: true },
        )).toBeVisible();
        await reviewBrief(page, brief, 'Drive Summary',
          'Stored drive summary and the loaded, telemetry-enriched GPS trail.');
        await expectNoHorizontalOverflow(page);
        await assertMockApiComplete(page, mocks);
      });

      test('recorded zero replay speed and 0-to-0 battery are not absent measurements', async ({ page }) => {
        await seedBrowserState(page, theme, replayPath);
        const mocks = await installApiMocks(page, 'populated', theme);
        await installDriveDetailMocks(page, theme, mocks);
        const zeroDrive = {
          ...mockDrive, id: DRIVE_DETAIL_ID, distance_m: 0, duration_s: 0,
          end_ts: mockDrive.start_ts, end_lat: mockDrive.start_lat, end_lon: mockDrive.start_lon,
          end_address: mockDrive.start_address,
          avg_speed_mps: 0, max_speed_mps: 0, energy_used_wh: 0,
          start_battery_pct: 0, end_battery_pct: 0, positions: [], telemetry: [],
        };
        await page.route(url => url.pathname === `/api/v1/drives/${DRIVE_DETAIL_ID}`,
          route => fulfillApiFixture(route, mocks, { json: zeroDrive }));
        await page.goto(replayPath);
        await waitForHarnessReady(page, mocks);
        const brief = await expectRealBrief(page, 'Drive Summary', 8);
        await expectMetric(brief, 'distance', '0.00 km');
        await expectMetric(brief, 'duration', '0m');
        await expectMetric(brief, 'average-speed', '0.00 km/h');
        await expectMetric(brief, 'maximum-speed', '0.00 km/h');
        await expectMetric(brief, 'battery', '0% → 0%');
        await expect(metric(brief, 'battery')).toContainText('Start 0% → end 0%');
        await expectMetric(brief, 'efficiency', '—', 'missing');
        await expectMetric(brief, 'elevation-gain', '—', 'missing');
        await expectMetric(brief, 'elevation-loss', '—', 'missing');
        await expectNoHorizontalOverflow(page);
        await assertMockApiComplete(page, mocks);
      });

      test('real replay refresh retains the published summary after a source failure', async ({ page }) => {
        test.setTimeout(60_000);
        await seedBrowserState(page, theme, replayPath);
        const mocks = await installApiMocks(page, 'populated', theme);
        await installDriveDetailMocks(page, theme, mocks);
        const diagnostics = monitorPage(page);
        await page.goto(replayPath);
        await waitForHarnessReady(page, mocks);
        const brief = await expectRealBrief(page, 'Drive Summary', 8);
        const before = await brief.locator('[data-operational-value]').allTextContents();
        let failedRequests = 0;
        await page.route(url => url.pathname === `/api/v1/drives/${DRIVE_DETAIL_ID}`, route => {
          expect(route.request().method()).toBe('GET');
          failedRequests += 1;
          return fulfillApiFixture(route, mocks, {
            status: 404, json: { error: 'Synthetic recorded drive unavailable during refresh' },
          });
        });
        await page.getByRole('button', { name: 'Refresh replay data', exact: true }).click();
        await expect(brief).toContainText('Retained source', { timeout: 30_000 });
        expect(failedRequests).toBeGreaterThan(0);
        await expectPublishedMetricsUnchanged(brief, before);
        const trigger = brief.getByRole('button', { name: 'Review details', exact: true });
        await trigger.focus();
        await trigger.press('Enter');
        const dialog = page.getByRole('dialog', { name: 'Drive Summary details', exact: true });
        await expect(dialog).toContainText('Retained source');
        await expect(dialog).toContainText('Stored drive summary and the loaded, telemetry-enriched GPS trail.');
        for (const value of before) await expect(dialog).toContainText(value);
        await expectDialogsInsideViewport(page);
        await page.keyboard.press('Escape');
        await expect(trigger).toBeFocused();
        await expectNoHorizontalOverflow(page);
        expect(diagnostics.pageErrors).toEqual([]);
        expect(diagnostics.brokenResources).toEqual([]);
        expect(diagnostics.failedDataRequests.length).toBeGreaterThan(0);
        expect(diagnostics.failedDataRequests.every(value => value.includes(`404 fetch`) &&
          value.includes(`/api/v1/drives/${DRIVE_DETAIL_ID}`))).toBe(true);
        await assertMockApiComplete(page, mocks);
      });
    });
  }
}

interface TripExport {
  id: number;
  total_distance_m: number;
  total_energy_wh: number;
}
