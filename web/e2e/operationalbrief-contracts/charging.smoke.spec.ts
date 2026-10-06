import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  assertMockApiComplete, fulfillApiFixture, installApiMocks,
  mockVehicle, seedBrowserState, waitForHarnessReady,
} from '../mockApi';
import {
  expectDialogsInsideViewport, expectNoHorizontalOverflow,
  expectNoRuntimeFailures, monitorPage,
} from '../qualityAssertions';
import {
  analysisWindow, autopilotPreview, autopilotProfile, autopilotSavings, billVariance, billingHistory,
  costForecast, fleetHistory, incompleteSession, invoicedSession,
  measuredWindow, optimizer, powershareFields, zeroPowershareObservation, zeroSession,
  optimizedCharge, ratePlans, unavailableChargeLedger, unavailableChargePhysics,
} from './charging.fixtures';

type Mocks = Awaited<ReturnType<typeof installApiMocks>>;
type Theme = 'light' | 'dark';

async function fixture(
  page: Page, mocks: Mocks, path: string, json: unknown,
  query: Readonly<Record<string, string>> = {},
) {
  await page.route(url => url.pathname === `/api/v1${path}`, async route => {
    expect(route.request().method(), `fixture method for ${path}`).toBe('GET');
    const params = new URL(route.request().url()).searchParams;
    for (const [key, expected] of Object.entries(query)) {
      expect(params.get(key), `${path} ${key}`).toBe(expected);
    }
    await fulfillApiFixture(route, mocks, { json });
  });
}

async function open(page: Page, theme: Theme, route: string) {
  expect(process.env.E2E_MOCKS, 'OperationalBrief contracts require strict synthetic API mocks').not.toBe('0');
  await seedBrowserState(page, theme, route);
  const diagnostics = monitorPage(page);
  const mocks = await installApiMocks(page, 'populated', theme);
  expect(mocks).not.toBeNull();
  return { mocks, diagnostics };
}

function brief(page: Page, id: string) {
  return page.locator(`#${id} [data-operational-brief]`);
}

async function value(section: Locator, key: string, expected: string, state = 'value') {
  const metric = section.locator(`[data-operational-metric="${key}"]`);
  await expect(metric).toHaveCount(1);
  await expect(metric).toHaveAttribute('data-value-state', state);
  await expect(metric.locator('[data-operational-value]')).toHaveText(expected);
}

async function review(page: Page, section: Locator, source: string, readings: readonly string[]) {
  const trigger = section.getByRole('button', { name: 'Review details', exact: true });
  await trigger.scrollIntoViewIfNeeded();
  await trigger.focus();
  await expect(trigger).toBeFocused();
  await page.keyboard.press('Enter');
  const drawer = page.getByRole('dialog');
  await expect(drawer).toHaveCount(1);
  await expect(drawer).toBeVisible();
  await expect(drawer).toHaveAttribute('aria-modal', 'true');
  await expect(drawer).toHaveAccessibleName(/details$/i);
  await expect(drawer.getByText(source, { exact: true }).first()).toBeVisible();
  for (const reading of readings) {
    await expect(drawer.getByText(reading, { exact: true }).first()).toBeVisible();
  }
  await expect.poll(() => drawer.evaluate(node => node.contains(document.activeElement))).toBe(true);
  for (const key of ['Tab', 'Shift+Tab', 'Tab']) {
    await page.keyboard.press(key);
    await expect.poll(() => drawer.evaluate(node => node.contains(document.activeElement))).toBe(true);
  }
  await expect.poll(async () => {
    const panel = await drawer.locator('[data-drawer-panel]').boundingBox();
    const viewport = page.viewportSize();
    return panel != null && viewport != null && panel.x >= -1
      && panel.x + panel.width <= viewport.width + 1;
  }).toBe(true);
  await expectDialogsInsideViewport(page);
  await expectNoHorizontalOverflow(page);
  await page.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);
  await expect(trigger).toBeFocused();
}

async function finish(page: Page, run: Awaited<ReturnType<typeof open>>) {
  await expectNoHorizontalOverflow(page);
  await assertMockApiComplete(page, run.mocks);
  await expectNoRuntimeFailures(run.diagnostics);
}

for (const theme of ['light', 'dark'] as const) {
  for (const width of [320, 1440]) {
    test(`charging returned-window evidence survives one-row pagination at ${width}px ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });
      const route = `/charging${analysisWindow}&size=1&density=compact`;
      const run = await open(page, theme, route);
      await fixture(page, run.mocks, '/charging', measuredWindow, {
        vehicle_id: '7', limit: '500', offset: '0',
        start: '2026-08-01T00:00:00.000Z', end: '2026-09-01T00:00:00.000Z',
      });
      await fixture(page, run.mocks, '/analytics/charging-optimizer', optimizer);
      await page.goto(route);
      await waitForHarnessReady(page, run.mocks);
      const overview = brief(page, 'charging-overview');
      await expect(overview).toHaveCount(1);
      await value(overview, 'charge.sessions:0', '2');
      await value(overview, 'charge.energyAdded:1', '54 kWh');
      await value(overview, 'charge.recordedCost:2', '$10.80');
      await value(overview, 'charge.overallRate:3', '21.60 kW');
      await value(overview, 'charge.avgDuration:4', '1h 15m');
      await value(overview, 'charge.meanSessionPower:5', '21.00 kW');
      const history = page.getByRole('region', { name: 'All charging sessions', exact: true });
      if (width === 1440) {
        await expect(history.getByRole('table').locator('tbody tr')).toHaveCount(1);
      }
      await expect(history.locator('a[href="/charging/201"]').first()).toBeVisible();
      await review(page, overview,
        'Search, collections, and exports cover up to 500 loaded sessions in this range.',
        ['54 kWh', '$10.80', '21.60 kW', '21.00 kW', '1h 15m']);
      const habits = page.getByRole('region', { name: /^Charging habits$/i });
      await value(habits, 'hour', '0:00');
      await value(habits, 'location', '—', 'missing');
      await expect(habits).toContainText('Location clusters do not confirm home charging.');
      await value(habits, 'sessions-week', '2.00');
      await value(habits, 'target', '80.00%');
      await review(page, habits,
        'Independent optimizer source; its history bounds are not reported. Recommendations and savings are illustrative, not measured outcomes.',
        ['0:00', 'Monday', '2.00', '80.00%']);
      const observedRates = page.locator('[data-operational-brief]').filter({
        has: page.locator('[data-operational-metric="peak-hours"]'),
      });
      await value(observedRates, 'peak', '$0.30/kWh');
      await value(observedRates, 'offpeak', '$0.10/kWh');
      await value(observedRates, 'peak-sessions', '0.00%');
      await review(page, observedRates,
        'Independent optimizer source; its history bounds are not reported. Recommendations and savings are illustrative, not measured outcomes.',
        ['$0.30/kWh', '$0.10/kWh', '0.00%']);
      const free = page.locator('[data-operational-brief]').filter({
        has: page.locator('[data-operational-metric="free-energy"]'),
      });
      await value(free, 'free-energy', '18.00 kWh');
      await expect(free.locator('[data-operational-metric="free-sessions"]'))
        .toHaveAttribute('data-value-state', 'value');
      await expect(free.locator('[data-operational-metric="free-sessions"] [data-operational-value]'))
        .toHaveText(/^1 sessions?$/);
      await review(page, free,
        'Recorded zero-cost sessions in the loaded AC/DC history; unknown costs are not counted as free.',
        ['18.00 kWh']);
      const delivery = page.locator('[data-operational-brief]').filter({
        has: page.locator('[data-operational-metric="observed"]'),
      });
      await value(delivery, 'average', '21.60 kW');
      await value(delivery, 'best', '24.00 kW');
      await value(delivery, 'worst', '18.00 kW');
      await value(delivery, 'observed', '54.00 kWh');
      await review(page, delivery,
        'Computed from the loaded history, independently of collection and search filters; only usable energy and positive completed-session duration contribute.',
        ['21.60 kW', '24.00 kW', '18.00 kW', '54.00 kWh']);
      const operating = page.getByTestId('charging-operational-brief');
      await value(operating, 'cost', '$10.80');
      await review(page, operating,
        'Independent wall-input and battery-retained energy are not present in the session contract; delivery rate is shown below instead.',
        ['$10.80']);
      const preview = history.getByRole('button', { name: 'Quick view charging session', exact: true }).first();
      await preview.focus();
      await page.keyboard.press('Enter');
      const sessionDrawer = page.getByRole('dialog');
      await expect(sessionDrawer.getByRole('link', { name: 'Vehicle', exact: true }))
        .toHaveAttribute('href', '/vehicles/7');
      await expect(sessionDrawer.getByRole('link', { name: 'Drive history', exact: true }))
        .toHaveAttribute('href', /\/drives\?/);
      await expect(sessionDrawer.getByRole('button', { name: 'Open session details', exact: true })).toBeVisible();
      await expectDialogsInsideViewport(page);
      await page.keyboard.press('Escape');
      await expect(preview).toBeFocused();
      await finish(page, run);
    });

    test(`charging curve keeps peak-power and elapsed-rate sources distinct at ${width}px ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });
      const route = `/charging-curve${analysisWindow}`;
      const run = await open(page, theme, route);
      await fixture(page, run.mocks, '/charging', measuredWindow, {
        vehicle_id: '7', limit: '200', start: '2026-08-01', end: '2026-08-31',
      });
      await page.goto(route);
      await waitForHarnessReady(page, run.mocks);
      const summary = brief(page, 'charging-curve-summary');
      await value(summary, 'totalSessions', '2');
      await value(summary, 'totalEnergy', '54.00 kWh');
      await value(summary, 'avgRate', '33.00 kW');
      await value(summary, 'peakRate', '44.00 kW');
      await value(summary, 'avgDuration', '75 min');
      await value(summary, 'totalCost', '$10.80');
      await expect(summary.locator('[data-operational-metric="avgRate"]')).toContainText('Arithmetic mean of session peak power');
      await review(page, summary, 'Up to 200 returned sessions; not a full-history aggregate.',
        ['33.00 kW', '44.00 kW', '75 min', '$10.80']);
      const threshold = page.getByRole('region', { name: /^Time-to-charge analysis$/i });
      await value(threshold, 'avg10to80', '75.00 min');
      await value(threshold, 'fastest', '24.00 kWh/h');
      await value(threshold, 'slowest', '18.00 kWh/h');
      await expect(threshold).toContainText('Session #202');
      await review(page, threshold,
        'Completed DC sessions from the returned history only. Threshold means exclude unfinished sessions; fastest and slowest use recorded energy divided by positive elapsed time.',
        ['75.00 min', '24.00 kWh/h', '18.00 kWh/h']);
      await finish(page, run);
    });

    test(`charging heatmap reports SI energy and positive-duration coverage at ${width}px ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });
      const route = `/charging-heatmap${analysisWindow}`;
      const run = await open(page, theme, route);
      await fixture(page, run.mocks, '/charging', [measuredWindow[0], incompleteSession], {
        vehicle_id: '7', limit: '2000', start: '2026-08-01', end: '2026-08-31',
      });
      await page.goto(route);
      await waitForHarnessReady(page, run.mocks);
      const summary = brief(page, 'charging-heatmap-summary');
      await value(summary, 'charging-heatmap-total-sessions', '2');
      await value(summary, 'charging-heatmap-total-energy', '36.00 kWh');
      await value(summary, 'charging-heatmap-total-cost', '$0.00');
      await value(summary, 'charging-heatmap-average-duration', '1.00 h');
      await expect(summary.locator('[data-operational-metric="charging-heatmap-total-cost"]'))
        .toContainText('Some returned sessions have no recorded value; the total includes recorded values only.');
      await review(page, summary,
        'Summary of the returned sessions for the shared vehicle and date scope (request limit: 2,000). This is not a complete-history total.',
        ['36.00 kWh', '$0.00', '1.00 h']);
      await finish(page, run);
    });

    test(`Tesla billing summary is lifetime while duration/sites are loaded at ${width}px ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });
      const route = `/tesla-charging-history${analysisWindow}`;
      const run = await open(page, theme, route);
      await fixture(page, run.mocks, '/tesla/charging/history', billingHistory);
      await page.goto(route);
      await waitForHarnessReady(page, run.mocks);
      const summary = brief(page, 'tesla-charging-history-summary');
      await value(summary, 'sessions', '40');
      await value(summary, 'energy', '720.00 kWh');
      await value(summary, 'spend', '$216.00');
      await value(summary, 'average-cost', '$0.30');
      await value(summary, 'duration', '3h 0m');
      await value(summary, 'sites', '2');
      const table = page.getByRole('table').filter({ hasText: 'Synthetic August site' });
      await expect(table).toHaveCount(1);
      await expect(table.locator('tbody tr')).toHaveCount(1);
      await expect(table).not.toContainText('Synthetic July site');
      await review(page, summary,
        'Tesla lifetime summary; duration and sites use all loaded records. The analysis window filters charts and the session table separately.',
        ['720.00 kWh', '$216.00', '3h 0m']);
      await finish(page, run);
    });

    test(`Fleet charging preserves separate lifetime and active-window totals at ${width}px ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });
      const route = `/tesla-charging-sessions${analysisWindow}`;
      const run = await open(page, theme, route);
      await fixture(page, run.mocks, '/tesla/charging/sessions', fleetHistory);
      await fixture(page, run.mocks, '/waitoracle/sites', []);
      await page.goto(route);
      await waitForHarnessReady(page, run.mocks);
      const lifetime = brief(page, 'tesla-fleet-charging-summary');
      await value(lifetime, 'sessions', '40');
      await value(lifetime, 'energy', '720.00 kWh');
      await value(lifetime, 'cost', '$216.00');
      await value(lifetime, 'peak-power', '44.00 kW');
      const active = page.getByTestId('charging-operational-brief');
      await expect(active).toHaveAttribute('data-operational-brief', '');
      await value(active, 'sessions', '1');
      await value(active, 'energy', '18.00 kWh');
      await value(active, 'cost', '$0.00');
      await value(active, 'duration', '1h 0m');
      await review(page, lifetime,
        'Tesla lifetime summary. The analysis window filters loaded sessions, charts, and operational totals separately.',
        ['720.00 kWh', '$216.00', '44.00 kW']);
      await review(page, active, 'Tesla Fleet Charging sessions',
        ['18.00 kWh', '$0.00', '1h 0m']);
      await finish(page, run);
    });

    test(`charge departure shows zero pairings without inventing a readiness margin at ${width}px ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });
      const route = '/charge-departure-alignment';
      const run = await open(page, theme, route);
      await fixture(page, run.mocks, '/charging', measuredWindow);
      await fixture(page, run.mocks, '/drives', []);
      await page.goto(route);
      await waitForHarnessReady(page, run.mocks);
      const summary = brief(page, 'charge-departure-alignment-summary');
      await value(summary, 'alignment-paired', '0');
      await value(summary, 'alignment-avg-dwell', '—', 'missing');
      await value(summary, 'alignment-avg-margin', '—', 'missing');
      await value(summary, 'alignment-misaligned-rate', '—', 'missing');
      await expect(summary).toContainText('No paired drive has a recorded end SoC.');
      await review(page, summary,
        'Selected vehicle · up to 1,000 charges and 1,000 drives from the existing queries. These are loaded records, not complete lifetime coverage; the workspace date range does not filter this model.',
        ['No paired drive has a recorded end SoC.']);
      await finish(page, run);
    });

    test(`charging detail retains independent invoice and pack truth at ${width}px ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });
      const route = '/charging/201';
      const run = await open(page, theme, route);
      await fixture(page, run.mocks, '/charging/201', invoicedSession);
      await fixture(page, run.mocks, '/charging/201/telemetry', []);
      await fixture(page, run.mocks, '/vehicles/7', mockVehicle);
      await fixture(page, run.mocks, '/physics/charging/201', unavailableChargePhysics);
      await fixture(page, run.mocks, '/physics/charging/201/ledger', unavailableChargeLedger);
      await page.goto(route);
      await waitForHarnessReady(page, run.mocks);
      const summary = brief(page, 'charging-detail-metrics');
      await expect(page.locator('#charging-detail-metrics')).toHaveAttribute('data-period-kind', 'event');
      await value(summary, 'jsx-17201', '20.00 kWh');
      await value(summary, 'jsx-17203', '60.00 min');
      await value(summary, 'jsx-17205', '22.00 kW');
      await value(summary, 'jsx-17207', '0.00–80.00%');
      await value(summary, 'jsx-17209', '$6.00');
      await value(summary, 'jsx-17213', '—', 'missing');
      await value(summary, 'jsx-17215', '20.00 kWh/h');
      await expect(summary).toContainText('Vehicle measured 18.00 kWh');
      await expect(summary.locator('[data-operational-metric="jsx-17209"]')).toContainText('Tesla invoice');
      const bill = page.getByTestId('charge-bill-truth').locator('[data-operational-brief]');
      await value(bill, 'billed', '20.00 kWh');
      await value(bill, 'pack', '18.00 kWh');
      await value(bill, 'delta', '2.00 kWh');
      await review(page, bill,
        'Tesla Supercharger invoices meter energy at the cabinet. Vehicle telemetry is energy into the pack and is often a few percent lower.',
        ['20.00 kWh', '18.00 kWh', '2.00 kWh']);
      await review(page, summary, 'Charge session',
        ['20.00 kWh', '$6.00', 'Vehicle measured 18.00 kWh']);
      await expect(page.getByRole('link', { name: 'Back to charging', exact: true })).toHaveAttribute('href', '/charging');
      await finish(page, run);
    });

    test(`thermal tax has real unknown slots before a session is selected at ${width}px ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });
      const route = '/charging-thermal-tax';
      const run = await open(page, theme, route);
      await fixture(page, run.mocks, '/charging', []);
      await page.goto(route);
      await waitForHarnessReady(page, run.mocks);
      const summary = brief(page, 'charging-thermal-tax-metrics');
      for (const key of ['thermal-heater-energy', 'thermal-heater-share', 'thermal-heater-on-time', 'thermal-peak-heater']) {
        await value(summary, key, '—', 'missing');
      }
      await expect(page.locator('#charging-thermal-tax-metrics')).toHaveAttribute('data-period-kind', 'unknown');
      await review(page, summary, 'No session selected.', ['no session selected']);
      expect(run.mocks?.requests.some(request => /\/charging\/\d+\/telemetry/.test(request.path))).toBe(false);
      await finish(page, run);
    });

    test(`interruption prior is not published as measured failure risk at ${width}px ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });
      const route = '/charge-interruption';
      const run = await open(page, theme, route);
      await fixture(page, run.mocks, '/charging', []);
      await page.goto(route);
      await waitForHarnessReady(page, run.mocks);
      const summary = brief(page, 'charge-interruption-summary');
      await value(summary, 'charge-interruption-overall-risk', '50.00%');
      await value(summary, 'charge-interruption-suspected', '0');
      await value(summary, 'charge-interruption-loaded-sessions', '0');
      await value(summary, 'charge-interruption-evaluable-sessions', '0');
      await value(summary, 'charge-interruption-highest-risk', '—', 'missing');
      const priorDisclosure = 'No evaluable sessions; this is the model prior, not an evidence-based estimate.';
      await expect(summary).toContainText(priorDisclosure);
      await review(page, summary,
        'Selected vehicle · up to 1,000 returned sessions. Coverage and time bounds are not reported; this model does not use the workspace date range.',
        ['50.00%', priorDisclosure]);
      await finish(page, run);
    });

    test(`charger health keeps insufficient baselines unknown at ${width}px ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });
      const route = '/charger-health';
      const run = await open(page, theme, route);
      await fixture(page, run.mocks, '/charging-sessions', measuredWindow);
      await page.goto(route);
      await waitForHarnessReady(page, run.mocks);
      const summary = brief(page, 'charger-health-metrics');
      await value(summary, 'charger-health-sites', '2');
      await value(summary, 'charger-health-underperforming', '—', 'missing');
      await value(summary, 'charger-health-fastest', '—', 'missing');
      await value(summary, 'charger-health-time-lost', '—', 'missing');
      await expect(summary).toContainText('No location has enough clean sessions for a health benchmark.');
      await review(page, summary,
        'The existing sessions endpoint returns an observed history window, not a guaranteed lifetime or calendar-year total.',
        ['No location has enough clean sessions for a health benchmark.']);
      await finish(page, run);
    });

    test(`charger resilience preserves actual zero fallback coverage at ${width}px ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });
      const route = '/charger-resilience';
      const run = await open(page, theme, route);
      await fixture(page, run.mocks, '/charging', [measuredWindow[0]]);
      await page.goto(route);
      await waitForHarnessReady(page, run.mocks);
      const summary = brief(page, 'charger-resilience-metrics');
      await value(summary, 'resilience-score', '0.00');
      await value(summary, 'effective-sites', '1.00');
      await value(summary, 'top-site-dependency', '100.00%');
      await value(summary, 'fallback-coverage', '0.00%');
      await expect(summary).toContainText('Synthetic home charger');
      await review(page, summary,
        'Calculated from returned charging history, not a complete time-range guarantee.',
        ['0.00%', '100.00%', 'Synthetic home charger']);
      await finish(page, run);
    });

    test(`Powershare zero observations remain values while absent signals stay unknown at ${width}px ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });
      const route = '/powershare';
      const run = await open(page, theme, route);
      await page.route(url => url.pathname === '/api/v1/signals/observations', async request => {
        const params = new URL(request.request().url()).searchParams;
        const field = params.get('field') ?? '';
        expect(powershareFields).toContain(field);
        expect(params.get('vehicle_id')).toBe('7');
        expect(params.has('signal_name')).toBe(false);
        expect(params.get('limit')).toBe(
          field === 'PowershareHoursLeft' || field === 'PowershareInstantaneousPowerKW' ? '48' : '1',
        );
        await fulfillApiFixture(request, run.mocks, { json: zeroPowershareObservation(field) });
      });
      await page.goto(route);
      await waitForHarnessReady(page, run.mocks);
      const summary = brief(page, 'powershare-metrics');
      await value(summary, 'status', '—', 'missing');
      await value(summary, 'type', '—', 'missing');
      await value(summary, 'output-power', '0.00 kW');
      await value(summary, 'hours-remaining', '0.00 h');
      await review(page, summary,
        'Latest recorded observations; the trends show up to 48 recent readings per signal, not a complete time range.',
        ['0.00 kW', '0.00 h']);
      await finish(page, run);
    });

    test(`cost summaries disclose returned rows and independent billing/forecast at ${width}px ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });
      const route = `/cost-analysis${analysisWindow}`;
      const run = await open(page, theme, route);
      await fixture(page, run.mocks, '/charging', measuredWindow, {
        vehicle_id: '7', limit: '1000', offset: '0', start: '2026-08-01', end: '2026-08-31',
      });
      await fixture(page, run.mocks, '/analytics/cost-forecast', costForecast, { vehicle_id: '7', months: '6' });
      await fixture(page, run.mocks, '/charging/bill-variance', billVariance, { vehicle_id: '7' });
      await page.goto(route);
      await waitForHarnessReady(page, run.mocks);
      const summary = page.locator('[data-operational-brief]').filter({
        has: page.locator('[data-operational-metric="energy:3"]'),
      });
      await expect(summary).toHaveCount(1);
      await value(summary, 'currency:0', '$10.80');
      await value(summary, 'currency:1', '$0.20');
      await value(summary, 'energy:3', '54.00 kWh');
      const returnedScope = 'Only returned charging sessions are summarized. The requested 1000-row limit does not prove completeness; these are not complete-window or lifetime totals.';
      await review(page, summary, returnedScope, ['$10.80', '$0.20', '54.00 kWh']);
      const lifetime = page.locator('[data-operational-brief]').filter({
        has: page.getByRole('heading', { name: /Lifetime summary/i }),
      });
      await value(lifetime, 'currency:0', '$10.80');
      await value(lifetime, 'energy:1', '54.00 kWh');
      await value(lifetime, 'count:2', '2');
      await value(lifetime, 'currency:3', '$5.40');
      await value(lifetime, 'energy:4', '27.00 kWh');
      await value(lifetime, 'duration:5', '75.00 min');
      await value(lifetime, 'count:6', '1');
      await review(page, lifetime, returnedScope, ['27.00 kWh', '75.00 min']);
      const reconciliation = page.locator('[data-operational-brief]').filter({
        has: page.locator('[data-operational-metric="energy:0"]'),
      }).filter({ has: page.locator('[data-operational-metric="percent:2"]') });
      await value(reconciliation, 'energy:0', '-2.00 kWh');
      await value(reconciliation, 'currency:1', '$-6.00');
      await value(reconciliation, 'currency:3', '$16.80');
      await review(page, reconciliation,
        'Reconciliation is independent of the selected date range; its reporting window is not supplied by this view.',
        ['-2.00 kWh', '$-6.00']);
      const forecast = page.locator('[data-operational-brief]').filter({
        has: page.getByRole('heading', { name: /Gas vs EV savings/i }),
      });
      await value(forecast, 'currency:0', '$9.20');
      await value(forecast, 'currency:2', '$0.00');
      await value(forecast, 'distance:5', '100.00 km');
      await review(page, forecast,
        'Forecast is independent of the selected date range; history and projection windows belong to the returned forecast, not a proven lifetime total.',
        ['$9.20', '$0.00', '100.00 km']);
      const breakdown = page.locator('[data-operational-brief]').filter({
        has: page.getByRole('heading', { name: /Charging breakdown/i }),
      });
      await value(breakdown, 'currency:0', '$0.00');
      await value(breakdown, 'currency:1', '$0.30');
      await review(page, breakdown,
        'Forecast is independent of the selected date range; history and projection windows belong to the returned forecast, not a proven lifetime total.',
        ['$0.00', '$0.30']);
      const assumptions = page.locator('[data-operational-brief]').filter({
        has: page.getByRole('heading', { name: /Evidence: Comparison/i }),
      });
      await value(assumptions, 'currency:0', '$0.00');
      await value(assumptions, 'currency:1', '$10.80');
      await value(assumptions, 'currency:2', '$-10.80');
      await value(assumptions, 'currency:3', '$-7.02');
      await review(page, assumptions, returnedScope, ['$10.80', '$-10.80', '$-7.02']);
      const timeOfUse = page.locator('[data-operational-brief]').filter({
        has: page.locator('[data-operational-metric="text:2"]'),
      });
      await value(timeOfUse, 'text:0', '08:00');
      await value(timeOfUse, 'text:1', '08:00');
      await value(timeOfUse, 'text:2', '08:00');
      await value(timeOfUse, 'percent:3', '0.00%');
      await review(page, timeOfUse, returnedScope, ['08:00', '0.00%']);
      const emissions = page.locator('[data-operational-brief]').filter({
        has: page.getByRole('heading', { name: /Evidence: Environmental impact/i }),
      });
      await value(emissions, 'number:0', '14.24');
      await value(emissions, 'number:1', '0.65');
      await review(page, emissions, returnedScope, ['14.24', '0.65']);
      const equivalents = page.locator('[data-operational-brief]').filter({
        has: page.locator('[data-operational-metric="number:2"]'),
      });
      await value(equivalents, 'number:0', '1.60');
      await value(equivalents, 'number:1', '0.01');
      await value(equivalents, 'number:2', '-5.19');
      await review(page, equivalents, returnedScope, ['1.60', '0.01', '-5.19']);
      await finish(page, run);
    });

    test(`smart charge keeps modeled costs separate from realized zero savings at ${width}px ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });
      const route = '/smart-charge';
      const run = await open(page, theme, route);
      await fixture(page, run.mocks, '/charge-planner/rate-plans', ratePlans);
      await fixture(page, run.mocks, '/charge-planner/history', [], { vehicle_id: '7' });
      await fixture(page, run.mocks, '/charge-autopilot/profile', autopilotProfile, { vehicle_id: '7' });
      await fixture(page, run.mocks, '/charge-autopilot/savings', autopilotSavings, { vehicle_id: '7' });
      await fixture(page, run.mocks, '/ocpp/charge-points', []);
      await fixture(page, run.mocks, '/ocpp/sessions', [], { charge_point_id: '', limit: '10' });
      let optimized = false;
      await page.route(url => url.pathname === '/api/v1/charge-planner/optimize', async request => {
        expect(request.request().method()).toBe('POST');
        const body: unknown = request.request().postDataJSON();
        expect(body).toMatchObject({
          vehicle_id: 7, target_soc: 80, rate_plan_id: 'synthetic-flat',
          max_amps: 32, battery_capacity_kwh: 75,
        });
        optimized = true;
        await fulfillApiFixture(request, run.mocks, { json: optimizedCharge });
      });
      let previewed = false;
      await page.route(url => url.pathname === '/api/v1/charge-autopilot/preview', async request => {
        expect(request.request().method()).toBe('POST');
        const body: unknown = request.request().postDataJSON();
        expect(body).toEqual({ vehicle_id: 7, current_soc: 50 });
        previewed = true;
        await fulfillApiFixture(request, run.mocks, { json: autopilotPreview });
      });
      await page.goto(route);
      await waitForHarnessReady(page, run.mocks);
      const summary = brief(page, 'smart-charge-cost-comparison');
      await value(summary, 'charge-now', '—', 'missing');
      await value(summary, 'energy-needed', '—', 'missing');
      const realized = page.locator('[data-operational-brief]').filter({
        has: page.locator('[data-operational-metric="realized-savings"]'),
      });
      await value(realized, 'realized-savings', '$0.00');
      await page.getByLabel('Depart by', { exact: true }).fill('2026-08-27T07:30');
      await page.getByRole('button', { name: 'Find cheapest window', exact: true }).click();
      await waitForHarnessReady(page, run.mocks);
      expect(optimized).toBe(true);
      await value(summary, 'charge-now', '$5.40');
      await value(summary, 'optimized-cost', '$1.80');
      await value(summary, 'savings', '$3.60');
      await value(summary, 'energy-needed', '18.00 kWh');
      await review(page, summary,
        'Optimizer estimates for the selected departure and rate plan; not measured charging costs.',
        ['$5.40', '$1.80', '$3.60', '18.00 kWh']);
      await value(realized, 'realized-savings', '$0.00');
      await review(page, realized,
        'Independent autopilot savings source; its time bounds are not reported and it is not scoped by the planner departure date.',
        ['$0.00']);
      const preview = brief(page, 'smart-charge-autopilot-preview');
      await value(preview, 'next-window', '—', 'missing');
      await value(preview, 'preview-savings', '—', 'missing');
      const previewTrigger = page.getByRole('button', { name: 'Preview next run', exact: true });
      await previewTrigger.focus();
      await page.keyboard.press('Enter');
      await waitForHarnessReady(page, run.mocks);
      expect(previewed).toBe(true);
      await value(preview, 'next-window', '10:00 PM');
      await value(preview, 'preview-savings', '$4.50');
      await review(page, preview,
        'Estimated next charge window from the current profile and SOC input; not an applied schedule.',
        ['10:00 PM', '$4.50']);
      await value(realized, 'realized-savings', '$0.00');
      await expect(page.getByRole('button', { name: 'Apply schedule', exact: true })).toBeVisible();
      expect(run.mocks?.requests.some(request =>
        /\/charge-planner\/apply|\/charge-autopilot\/run/.test(request.path))).toBe(false);
      await finish(page, run);
    });
  }
}

test('free charging excludes an unknown-cost session rather than treating null as zero', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 1000 });
  const route = `/charging${analysisWindow}`;
  const run = await open(page, 'dark', route);
  await fixture(page, run.mocks, '/charging', [zeroSession, { ...incompleteSession, id: 203 }]);
  await fixture(page, run.mocks, '/analytics/charging-optimizer', optimizer);
  await page.goto(route);
  await waitForHarnessReady(page, run.mocks);
  const overview = brief(page, 'charging-overview');
  await value(overview, 'charge.sessions:0', '2');
  await value(overview, 'charge.recordedCost:2', '$0.00');
  const free = page.locator('[data-operational-brief]').filter({
    has: page.locator('[data-operational-metric="free-energy"]'),
  });
  await value(free, 'free-energy', '0.00 kWh');
  await expect(free.locator('[data-operational-metric="free-sessions"] [data-operational-value]'))
    .toHaveText(/^1 sessions?$/);
  await review(page, free,
    'Recorded zero-cost sessions in the loaded AC/DC history; unknown costs are not counted as free.',
    ['0.00 kWh']);
  await finish(page, run);
});

test('heatmap distinguishes measured zero from absent costs and unfinished duration', async ({ page }) => {
  const route = `/charging-heatmap${analysisWindow}`;
  const run = await open(page, 'dark', route);
  await fixture(page, run.mocks, '/charging', [zeroSession]);
  await page.goto(route);
  await waitForHarnessReady(page, run.mocks);
  const summary = brief(page, 'charging-heatmap-summary');
  await value(summary, 'charging-heatmap-total-energy', '0.00 kWh');
  await value(summary, 'charging-heatmap-total-cost', '$0.00');
  await value(summary, 'charging-heatmap-average-duration', '1.00 h');
  await fixture(page, run.mocks, '/charging', [{ ...zeroSession, cost_decimal: null, ended_at: null }]);
  const refresh = page.getByRole('button', { name: 'Refresh', exact: true });
  await refresh.click();
  await waitForHarnessReady(page, run.mocks);
  await value(summary, 'charging-heatmap-total-energy', '0.00 kWh');
  await value(summary, 'charging-heatmap-total-cost', '—', 'missing');
  await value(summary, 'charging-heatmap-average-duration', '—', 'missing');
  await expect(summary).toContainText('No completed session with a positive measured duration');
  await finish(page, run);
});

test('heatmap retains its published readings after a real failed refresh', async ({ page }) => {
  const route = `/charging-heatmap${analysisWindow}`;
  const run = await open(page, 'light', route);
  await fixture(page, run.mocks, '/charging', measuredWindow);
  await page.goto(route);
  await waitForHarnessReady(page, run.mocks);
  const summary = brief(page, 'charging-heatmap-summary');
  await value(summary, 'charging-heatmap-total-energy', '54.00 kWh');
  await page.route(url => url.pathname === '/api/v1/charging', route =>
    fulfillApiFixture(route, run.mocks, { status: 503, json: { error: 'Synthetic refresh unavailable' } }));
  const failed = page.waitForResponse(response =>
    new URL(response.url()).pathname === '/api/v1/charging' && response.status() === 503);
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await failed;
  await expect(page.locator('#charging-heatmap-summary')).toHaveAttribute('data-retained', 'true', { timeout: 30000 });
  await value(summary, 'charging-heatmap-total-energy', '54.00 kWh');
  await value(summary, 'charging-heatmap-total-cost', '$10.80');
  await expect(summary).toContainText('Retained source measurements');
  await review(page, summary,
    'Summary of the returned sessions for the shared vehicle and date scope (request limit: 2,000). This is not a complete-history total.',
    ['54.00 kWh', '$10.80']);
  await expectNoHorizontalOverflow(page);
  await assertMockApiComplete(page, run.mocks);
  // The deliberately failed source is not a render failure.
  expect(run.diagnostics.pageErrors).toEqual([]);
  expect(run.diagnostics.brokenResources).toEqual([]);
  expect(run.diagnostics.failedDataRequests.length).toBeGreaterThan(0);
  expect(run.diagnostics.failedDataRequests.every(request =>
    /^503 (fetch|xhr) /.test(request)
      && new URL(request.replace(/^503 (fetch|xhr) /, '')).pathname === '/api/v1/charging')).toBe(true);
});
