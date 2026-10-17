import { expect, test, type Locator, type Page } from '@playwright/test';
import { formatDateTime } from '../../src/lib/dateFormat';
import { ROUTE_REGISTRY } from '../../src/lib/routeRegistry';
import {
  assertMockApiComplete,
  expectThemeApplied,
  fulfillApiFixture,
  installApiMocks,
  mockAppSettings,
  seedBrowserState,
  waitForHarnessReady,
  type MockApiController,
} from '../mockApi';
import {
  expectDialogsInsideViewport,
  expectNoHorizontalOverflow,
  expectNoRuntimeFailures,
  monitorPage,
  type PageDiagnostics,
} from '../qualityAssertions';
import {
  fleetForecastFrom,
  fleetForecastTo,
  fleetNow,
  fleetOpsFixtures,
  fleetRoute,
  type FleetOpsFixtures,
} from './fleet-ops.fixtures';

test.use({ locale: 'en-US', timezoneId: 'UTC', reducedMotion: 'reduce' });

type MetricKey = 'reservations' | 'assignments' | 'work-orders' | 'forecast';
type ListResource = 'drivers' | 'assignments' | 'reservations' | 'cost-centers'
  | 'charging-policies' | 'work-orders';
type SourceResource = ListResource | 'utilization-forecast';

interface SourceControl {
  failed: Set<SourceResource>;
  requested: Map<SourceResource, number>;
}

const sourceLists = [
  ['drivers', 'drivers'],
  ['assignments', 'assignments'],
  ['reservations', 'reservations'],
  ['cost-centers', 'costCenters'],
  ['charging-policies', 'policies'],
  ['work-orders', 'workOrders'],
] as const;
const keys: readonly MetricKey[] = ['reservations', 'assignments', 'work-orders', 'forecast'];
const unavailableSources = [
  ['reservations', 'reservations'],
  ['assignments', 'assignments'],
  ['work-orders', 'work-orders'],
  ['forecast', 'utilization-forecast'],
] as const;
const dateOptions = { locale: 'en-US', tz: 'UTC' } as const;
const sourceWindow = `Forecast source window: ${formatDateTime(fleetForecastFrom, dateOptions)} – ${formatDateTime(fleetForecastTo, dateOptions)}`;
const provenance = 'Fleet assignment, reservation and work-order API records; inferred utilization forecast. Loaded counts are not server-wide totals.';

function brief(page: Page): Locator {
  return page.getByTestId('fleet-operations-summary');
}

function metric(page: Page, key: MetricKey): Locator {
  return brief(page).locator(`[data-operational-metric="${key}"]`);
}

async function expectBriefFits(page: Page) {
  await expectNoHorizontalOverflow(page);
  const layout = await brief(page).evaluate((root) => {
    const bounds = root.getBoundingClientRect();
    return {
      left: bounds.left, right: bounds.right, width: innerWidth,
      metrics: [...root.querySelector<HTMLElement>('[data-operational-metric]')].map((node) => {
        const box = node.getBoundingClientRect();
        return {
          key: node.dataset.operationalMetric, left: box.left, right: box.right,
          scrollWidth: node.scrollWidth, clientWidth: node.clientWidth,
        };
      }),
    };
  });
  expect(layout.left).toBeGreaterThanOrEqual(-1);
  expect(layout.right).toBeLessThanOrEqual(layout.width + 1);
  for (const item of layout.metrics) {
    expect(item.left, item.key).toBeGreaterThanOrEqual(layout.left - 1);
    expect(item.right, item.key).toBeLessThanOrEqual(layout.right + 1);
    expect(item.scrollWidth, item.key).toBeLessThanOrEqual(item.clientWidth + 1);
  }
}

async function expectValue(
  page: Page,
  key: MetricKey,
  value: string,
  state: 'value' | 'missing' = 'value',
) {
  await expect(metric(page, key)).toHaveAttribute('data-value-state', state);
  await expect(metric(page, key).locator('[data-operational-value]')).toHaveText(value);
}

async function setup(
  page: Page,
  theme: 'light' | 'dark',
  fixture: FleetOpsFixtures,
  failures: SourceResource[] = [],
) {
  expect(ROUTE_REGISTRY.find((entry) => entry.path === fleetRoute)?.name).toBe('FleetOperations');
  await page.clock.setFixedTime(new Date(fleetNow));
  await seedBrowserState(page, theme, fleetRoute);
  const mocks = await installApiMocks(page, 'populated', theme);
  if (!mocks) throw new Error('Fleet OperationalBrief contracts require E2E_MOCKS enabled');
  const control: SourceControl = { failed: new Set(failures), requested: new Map() };
  await page.route((url) => url.pathname === '/api/v1/settings', async (route) => {
    expect(route.request().method()).toBe('GET');
    expect(new URL(route.request().url()).search).toBe('');
    await fulfillApiFixture(route, mocks, {
      json: { ...mockAppSettings, mode: theme, decimal_precision: 1 },
    });
  });
  for (const [resource, field] of sourceLists) {
    await page.route((url) => url.pathname === `/api/v1/fleet-ops/${resource}`, async (route) => {
      expect(route.request().method()).toBe('GET');
      expect([...new URL(route.request().url()).searchParams]).toEqual([['limit', '100']]);
      control.requested.set(resource, (control.requested.get(resource) ?? 0) + 1);
      await fulfillApiFixture(route, mocks, control.failed.has(resource)
        ? { status: 503, json: { error: `Synthetic ${resource} source unavailable` } }
        : { json: fixture[field] });
    });
  }
  await page.route((url) => url.pathname === '/api/v1/fleet-ops/utilization-forecast', async (route) => {
    expect(route.request().method()).toBe('GET');
    expect([...new URL(route.request().url()).searchParams]).toEqual([
      ['from', fleetForecastFrom], ['to', fleetForecastTo],
    ]);
    control.requested.set('utilization-forecast', (control.requested.get('utilization-forecast') ?? 0) + 1);
    await fulfillApiFixture(route, mocks, control.failed.has('utilization-forecast')
      ? { status: 503, json: { error: 'Synthetic forecast source unavailable' } }
      : { json: fixture.forecast });
  });
  await page.goto(fleetRoute);
  await waitForHarnessReady(page, mocks);
  await expect(brief(page)).toHaveAttribute('data-operational-brief', '');
  await expect(brief(page).locator('[data-operational-metric]')).toHaveCount(4);
  await expectThemeApplied(page, theme);
  return { mocks, control };
}

async function expectSourceLedger(mocks: MockApiController) {
  for (const [resource] of sourceLists) {
    expect(mocks.seen.has(`GET /fleet-ops/${resource}?limit=100`), resource).toBe(true);
  }
  const query = new URLSearchParams({ from: fleetForecastFrom, to: fleetForecastTo });
  expect(mocks.seen.has(`GET /fleet-ops/utilization-forecast?${query}`)).toBe(true);
  expect(mocks.requests.filter((request) => request.path.startsWith('/api/v1/fleet-ops/'))
    .every((request) => request.method === 'GET' && request.disposition === 'fulfilled')).toBe(true);
}

async function expectPopulatedSummary(page: Page) {
  for (const key of ['reservations', 'assignments', 'work-orders'] as const) {
    await expectValue(page, key, '2');
    await expect(metric(page, key)).toContainText('Operational lists are not date-filtered.');
    await expect(metric(page, key)).toContainText('Loaded source data');
    await expect(metric(page, key)).toContainText(`Received ${formatDateTime(fleetNow, dateOptions)}`);
  }
  await expect(metric(page, 'reservations')).toContainText('4 loaded of 4 source records; offset 0, limit 100');
  await expect(metric(page, 'assignments')).toContainText('3 loaded of 3 source records; offset 0, limit 100');
  await expect(metric(page, 'work-orders')).toContainText('4 loaded of 4 source records; offset 0, limit 100');
  await expect(metric(page, 'assignments')).toContainText('not a count of assignments active at this instant');
  await expectValue(page, 'forecast', '40.3%');
  await expect(metric(page, 'forecast')).toContainText(sourceWindow);
  await expect(metric(page, 'forecast')).toContainText('14-day fleet average');
  await expect(metric(page, 'forecast')).toContainText('3 returned vehicle-day points');
  await expect(metric(page, 'forecast')).toContainText('Forecast limitations: Moderate history.');
  await expect(metric(page, 'forecast')).toContainText(
    `Forecast generated ${formatDateTime('2026-10-06T11:00:00Z', dateOptions)}`,
  );
  await expect(brief(page)).toContainText('Fleet-wide · Loaded operational records');
  await expect(brief(page)).toContainText('Independent source snapshots');
  await expect(brief(page)).not.toHaveAttribute('aria-busy', 'true');
  // The released band has no metric href or action slot. Do not invent one.
  await expect(brief(page).getByRole('link')).toHaveCount(0);
}

async function reviewDetails(page: Page, width: number) {
  const review = brief(page).getByRole('button', { name: 'Review details', exact: true });
  const contextBefore = await Promise.all(keys.map((key) => metric(page, key).textContent()));
  await review.focus();
  await expect(review).toBeFocused();
  await page.keyboard.press('Enter');
  const drawer = page.getByRole('dialog', { name: 'Operational record summary details', exact: true });
  await expect(drawer).toBeVisible();
  await expect(drawer).toHaveAttribute('aria-modal', 'true');
  await expect(drawer).toContainText(provenance);
  for (const context of contextBefore) {
    if (context == null) throw new Error('Published metric context is missing');
    await expect(drawer).toContainText(context);
  }
  const closeButtons = drawer.getByRole('button', { name: 'Close', exact: true });
  await expect(closeButtons).toHaveCount(2);
  const close = closeButtons.first();
  await expect(close).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(closeButtons.last()).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(close).toBeFocused();
  await expect.poll(async () => {
    const box = await drawer.locator('[data-drawer-panel]').boundingBox();
    return box != null && box.x >= -1 && box.x + box.width <= width + 1;
  }).toBe(true);
  await expectDialogsInsideViewport(page);
  const body = drawer.locator('[data-drawer-body]');
  expect(await body.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
  await expectBriefFits(page);
  await page.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);
  await expect(review).toBeFocused();
  expect(await Promise.all(keys.map((key) => metric(page, key).textContent()))).toEqual(contextBefore);
}

async function expectOnlySourceFailures(diagnostics: PageDiagnostics, resources: SourceResource[]) {
  expect(diagnostics.pageErrors).toEqual([]);
  expect(diagnostics.brokenResources).toEqual([]);
  expect(diagnostics.failedDataRequests.length).toBeGreaterThan(0);
  for (const failure of diagnostics.failedDataRequests) {
    const match = /^503 (?:fetch|xhr) (https?:\/\/\S+)$/.exec(failure);
    expect(match, failure).not.toBeNull();
    if (!match) throw new Error(`Unexpected data failure: ${failure}`);
    const url = new URL(match[1]!);
    expect(resources.map((resource) => `/api/v1/fleet-ops/${resource}`)).toContain(url.pathname);
  }
  for (const message of diagnostics.consoleErrors) {
    expect(message).toMatch(/^Failed to load resource: the server responded with a status of 503 \(Service Unavailable\)$/);
  }
}

for (const theme of ['light', 'dark'] as const) {
  for (const width of [320, 1440] as const) {
    test.describe(`fleet OperationalBrief ${width}px ${theme}`, () => {
      test.use({ viewport: { width, height: 1000 } });

      test('preserves loaded operands, independent windows and keyboard Review details', async ({ page }) => {
        const diagnostics = monitorPage(page);
        const { mocks } = await setup(page, theme, fleetOpsFixtures());
        await expectPopulatedSummary(page);
        await expectBriefFits(page);
        await reviewDetails(page, width);
        await expectSourceLedger(mocks);
        await expectNoRuntimeFailures(diagnostics);
        await assertMockApiComplete(page, mocks);
      });

      test('successful empty lists publish real zero while an empty forecast stays unknown', async ({ page }) => {
        const diagnostics = monitorPage(page);
        const { mocks } = await setup(page, theme, fleetOpsFixtures('empty'));
        for (const key of ['reservations', 'assignments', 'work-orders'] as const) {
          await expectValue(page, key, '0');
          await expect(metric(page, key)).toContainText('0 loaded of 0 source records; offset 0, limit 100');
          await expect(metric(page, key)).toContainText('Loaded source data');
        }
        await expectValue(page, 'forecast', '—', 'missing');
        await expect(metric(page, 'forecast')).toContainText('0 returned vehicle-day points');
        await expect(metric(page, 'forecast')).toContainText(sourceWindow);
        await expect(brief(page)).toContainText('Partial source coverage');
        await reviewDetails(page, width);
        await expectBriefFits(page);
        await expectSourceLedger(mocks);
        await expectNoRuntimeFailures(diagnostics);
        await assertMockApiComplete(page, mocks);
      });

      test('a measured zero forecast is not missing or converted into a health score', async ({ page }) => {
        const diagnostics = monitorPage(page);
        const { mocks } = await setup(page, theme, fleetOpsFixtures('zeroForecast'));
        await expectValue(page, 'forecast', '0.0%');
        await expect(metric(page, 'forecast')).toContainText('1 returned vehicle-day points');
        await expect(brief(page)).toContainText('Loaded source data');
        await expect(brief(page)).not.toContainText('Partial source coverage');
        await reviewDetails(page, width);
        await expectBriefFits(page);
        await expectSourceLedger(mocks);
        await expectNoRuntimeFailures(diagnostics);
        await assertMockApiComplete(page, mocks);
      });

      for (const [unavailableKey, resource] of unavailableSources) {
        test(`unavailable ${unavailableKey} source remains unknown without blanking independent metrics`, async ({ page }) => {
          test.setTimeout(90_000);
          const diagnostics = monitorPage(page);
          const { mocks } = await setup(page, theme, fleetOpsFixtures(), [resource]);
          await expectValue(page, unavailableKey, '—', 'missing');
          await expect(metric(page, unavailableKey)).toContainText('Source unavailable');
          await expect(metric(page, unavailableKey)).toContainText(unavailableKey === 'forecast'
            ? 'Forecast source window unavailable' : 'List coverage unavailable');
          await expect(metric(page, unavailableKey)).toContainText('Source receipt time unavailable');
          for (const key of keys.filter((key) => key !== unavailableKey)) {
            await expectValue(page, key, key === 'forecast' ? '40.3%' : '2');
          }
          await expect(brief(page)).toContainText('Partial source coverage');
          await reviewDetails(page, width);
          await expectBriefFits(page);
          await expectSourceLedger(mocks);
          await expectOnlySourceFailures(diagnostics, [resource]);
          await assertMockApiComplete(page, mocks);
        });
      }

      test('failed refresh retains publication, source receipts and open Review details through recovery', async ({ page }) => {
        test.setTimeout(90_000);
        const diagnostics = monitorPage(page);
        const { mocks, control } = await setup(page, theme, fleetOpsFixtures());
        await expectPopulatedSummary(page);
        const receipt = await metric(page, 'reservations').textContent();
        const requestsBefore = control.requested.get('reservations') ?? 0;
        control.failed.add('reservations');
        await page.locator('[data-role="page-header"]')
          .getByRole('button', { name: /^Refresh data ·/ }).click();
        const review = brief(page).getByRole('button', { name: 'Review details', exact: true });
        await review.focus();
        await page.keyboard.press('Enter');
        const drawer = page.getByRole('dialog', { name: 'Operational record summary details', exact: true });
        await expect(drawer).toBeVisible();
        await expect(metric(page, 'reservations')).toContainText('Retained source data', { timeout: 45_000 });
        await expectValue(page, 'reservations', '2');
        await expectValue(page, 'assignments', '2');
        await expectValue(page, 'forecast', '40.3%');
        await expect(drawer).toContainText('Retained source data');
        await expect(drawer).toContainText('Received ' + formatDateTime(fleetNow, dateOptions));
        await expect(drawer).toContainText('4 loaded of 4 source records; offset 0, limit 100');
        await expect(drawer).toContainText(sourceWindow);
        expect(control.requested.get('reservations')).toBeGreaterThan(requestsBefore);
        await expectDialogsInsideViewport(page);
        await expectBriefFits(page);
        await page.keyboard.press('Escape');
        await expect(review).toBeFocused();
        control.failed.delete('reservations');
        const warning = page.getByTestId('stale-refresh-warning')
          .filter({ hasText: 'Reservation calendar may be out of date' });
        await warning.getByRole('button', { name: 'Refresh', exact: true }).click();
        await waitForHarnessReady(page, mocks);
        await expect(warning).toHaveCount(0);
        await expectPopulatedSummary(page);
        expect(await metric(page, 'reservations').textContent()).toBe(receipt);
        await expectSourceLedger(mocks);
        await expectOnlySourceFailures(diagnostics, ['reservations']);
        await assertMockApiComplete(page, mocks);
      });

      test('preserves real reservation editors and forecast data/export navigation', async ({ page }) => {
        const diagnostics = monitorPage(page);
        const { mocks } = await setup(page, theme, fleetOpsFixtures());
        await expectPopulatedSummary(page);
        const reserve = page.getByRole('button', { name: 'New reservation', exact: true });
        await reserve.focus();
        await page.keyboard.press('Enter');
        const create = page.getByRole('dialog', { name: 'Create reservation', exact: true });
        await expect(create).toBeVisible();
        await expect(create.getByRole('textbox', { name: 'Reservation name required', exact: true })).toHaveValue('');
        await expect(create.getByRole('combobox', { name: 'Vehicle required', exact: true })).toBeEnabled();
        await expectDialogsInsideViewport(page);
        await expectBriefFits(page);
        await page.keyboard.press('Escape');
        await expect(create).toHaveCount(0);
        await expect(reserve).toBeFocused();
        const edit = page.getByRole('button', { name: 'Edit Airport run', exact: true }).first();
        await edit.click();
        const editor = page.getByRole('dialog', { name: 'Edit reservation', exact: true });
        await expect(editor).toBeVisible();
        await expect(editor.getByRole('textbox', { name: 'Reservation name required', exact: true })).toHaveValue('Airport run');
        await expect(editor.getByRole('combobox', { name: 'Vehicle required', exact: true })).toHaveValue('7');
        await expect(editor.getByLabel(/^Starts(?:\s|$)/)).toHaveValue('2026-10-07T10:00');
        await expect(editor.getByLabel(/^Ends(?:\s|$)/)).toHaveValue('2026-10-07T11:00');
        await expect(editor.getByRole('button', { name: 'Cancel reservation', exact: true })).toBeEnabled();
        await expect(editor.getByRole('button', { name: 'Delete', exact: true })).toBeEnabled();
        await expectDialogsInsideViewport(page);
        await page.keyboard.press('Escape');
        await expect(editor).toHaveCount(0);
        await expect(edit).toBeFocused();

        const chart = page.locator('[data-chart-key="fleet-ops-utilization"]');
        await chart.scrollIntoViewIfNeeded();
        await expect(chart).toHaveAttribute('data-chart-state', 'ready');
        const table = chart.getByRole('table', { name: 'Utilization forecast — data table', exact: true });
        await expect(table.getByRole('columnheader')).toHaveText([
          'Date', 'Expected utilization', 'Lower bound', 'Upper bound',
        ]);
        await expect(table.locator('tbody tr')).toHaveCount(2);
        await expect(table.locator('tbody tr').nth(0).getByRole('cell')).toHaveText([
          '2026-10-07', '30.3', '15', '45',
        ]);
        await expect(table.locator('tbody tr').nth(1).getByRole('cell')).toHaveText([
          '2026-10-08', '60.3', '40', '75',
        ]);
        await chart.getByRole('button', { name: 'Export chart', exact: true }).click();
        const menu = chart.getByRole('menu', { name: 'Export chart', exact: true });
        for (const name of ['Save as PNG', 'Save as SVG', 'Copy image to clipboard']) {
          await expect(menu.getByRole('menuitem', { name, exact: true })).toBeEnabled();
        }
        await expectBriefFits(page);
        const downloadPromise = page.waitForEvent('download');
        await menu.getByRole('menuitem', { name: 'Save as SVG', exact: true }).click();
        const download = await downloadPromise;
        expect(download.suggestedFilename()).toBe('utilization-forecast-2026-10-06.svg');
        expect(await download.failure()).toBeNull();
        const stream = await download.createReadStream();
        if (!stream) throw new Error('Forecast SVG download has no readable content');
        const chunks: Buffer[] = [];
        for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        const svg = Buffer.concat(chunks).toString('utf8');
        expect(svg).toContain('<svg');
        expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
        expect(svg).toContain('recharts');
        await expect(menu).toHaveCount(0);
        await expectValue(page, 'forecast', '40.3%');
        await expectSourceLedger(mocks);
        await expectBriefFits(page);
        await expectNoRuntimeFailures(diagnostics);
        await assertMockApiComplete(page, mocks);
      });
    });
  }
}
