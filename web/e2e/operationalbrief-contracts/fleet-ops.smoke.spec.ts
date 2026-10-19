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
      metrics: [...root.querySelectorAll<HTMLElement>('[data-operational-metric]')].map((node) => {
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
  expectedMetricCount = 4,
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
  await expect(brief(page)).toHaveAttribute('data-operational-brief', 'true');
  // Withheld (non-value) metrics never render: scenarios with an unknown
  // source pin 3, not 4.
  await expect(brief(page).locator('[data-operational-metric]')).toHaveCount(expectedMetricCount);
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

async function expectPopulatedSummary(page: Page): Promise<string[]> {
  for (const key of ['reservations', 'assignments', 'work-orders'] as const) {
    await expectValue(page, key, '2');
  }
  await expectValue(page, 'forecast', '40.3%');
  await expect(brief(page)).not.toHaveAttribute('aria-busy', 'true');
  // The released band has no metric href or action slot. Do not invent one.
  await expect(brief(page).getByRole('link')).toHaveCount(0);
  // Scope, description, and metric details render in the Review drawer, not
  // inline (the brief shows title + labels + values by contract).
  return [
    'Fleet-wide · Loaded operational records',
    'Independent source snapshots',
    'Operational lists are not date-filtered.',
    'Loaded source data',
    `Received ${formatDateTime(fleetNow, dateOptions)}`,
    '4 loaded of 4 source records; offset 0, limit 100',
    '3 loaded of 3 source records; offset 0, limit 100',
    'not a count of assignments active at this instant',
    sourceWindow,
    '14-day fleet average',
    '3 returned vehicle-day points',
    'Forecast limitations: Moderate history.',
    `Forecast generated ${formatDateTime('2026-10-06T11:00:00Z', dateOptions)}`,
  ];
}

async function reviewDetails(
  page: Page,
  width: number,
  expectedKeys: readonly MetricKey[] = keys,
  scopes: readonly (string | RegExp)[] = [],
) {
  const review = brief(page).getByRole('button', { name: 'Review details', exact: true });
  const contextBefore = await Promise.all(expectedKeys.map((key) => metric(page, key).textContent()));
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
  for (const scope of scopes) {
    await expect(drawer).toContainText(scope);
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
  expect(await Promise.all(expectedKeys.map((key) => metric(page, key).textContent()))).toEqual(contextBefore);
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
        const scopes = await expectPopulatedSummary(page);
        await expectBriefFits(page);
        await reviewDetails(page, width, keys, scopes);
        await expectSourceLedger(mocks);
        await expectNoRuntimeFailures(diagnostics);
        await assertMockApiComplete(page, mocks);
      });

      test('successful empty lists publish real zero while an empty forecast stays unknown', async ({ page }) => {
        const diagnostics = monitorPage(page);
        const { mocks } = await setup(page, theme, fleetOpsFixtures('empty'), [], 3);
        for (const key of ['reservations', 'assignments', 'work-orders'] as const) {
          await expectValue(page, key, '0');
        }
        // The unknown forecast is withheld, never a zero or a '—' placeholder.
        await expect(metric(page, 'forecast')).toHaveCount(0);
        // Status, scope, and metric details render in the drawer, not the brief.
        await reviewDetails(page, width, ['reservations', 'assignments', 'work-orders'], [
          'Partial source coverage',
          '0 loaded of 0 source records; offset 0, limit 100',
          'Loaded source data',
          '1 empty field is hidden.',
        ]);
        await expectBriefFits(page);
        await expectSourceLedger(mocks);
        await expectNoRuntimeFailures(diagnostics);
        await assertMockApiComplete(page, mocks);
      });

      test('a measured zero forecast is not missing or converted into a health score', async ({ page }) => {
        const diagnostics = monitorPage(page);
        const { mocks } = await setup(page, theme, fleetOpsFixtures('zeroForecast'));
        await expectValue(page, 'forecast', '0.0%');
        // Status renders in the drawer header, not the brief.
        await reviewDetails(page, width, keys, ['1 returned vehicle-day points', 'Loaded source data']);
        await expect(brief(page)).not.toContainText('Partial source coverage');
        await expectBriefFits(page);
        await expectSourceLedger(mocks);
        await expectNoRuntimeFailures(diagnostics);
        await assertMockApiComplete(page, mocks);
      });

      for (const [unavailableKey, resource] of unavailableSources) {
        test(`unavailable ${unavailableKey} source remains unknown without blanking independent metrics`, async ({ page }) => {
          test.setTimeout(90_000);
          const diagnostics = monitorPage(page);
          const { mocks } = await setup(page, theme, fleetOpsFixtures(), [resource], 3);
          // The failed source is withheld, never a '—' placeholder; its
          // details never render, so the drawer names the hidden field.
          await expect(metric(page, unavailableKey)).toHaveCount(0);
          for (const key of keys.filter((key) => key !== unavailableKey)) {
            await expectValue(page, key, key === 'forecast' ? '40.3%' : '2');
          }
          await reviewDetails(
            page, width,
            keys.filter((key) => key !== unavailableKey),
            ['Partial source coverage', '1 empty field is hidden.'],
          );
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
        // Retention state is metric detail: wait for it in the drawer, where
        // details render (the brief metric shows label + value only).
        await expect(drawer).toContainText('Retained source data', { timeout: 45_000 });
        await expectValue(page, 'reservations', '2');
        await expectValue(page, 'assignments', '2');
        await expectValue(page, 'forecast', '40.3%');
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
