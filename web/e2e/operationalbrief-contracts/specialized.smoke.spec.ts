import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  assertMockApiComplete, expectThemeApplied, fulfillApiFixture,
  installApiMocks, seedBrowserState, waitForHarnessReady,
  type MockApiController,
} from '../mockApi';
import {
  expectDialogsInsideViewport, expectNoHorizontalOverflow,
  expectNoRuntimeFailures, monitorPage,
} from '../qualityAssertions';
import { CURATED_CATALOG } from '../../src/features/power-user/components/sqlCatalog';
import {
  arrivalTelemetry, componentBoard, detectorSnapshot, durableSetupDuringOutage,
  efficiencyShift,
  incompleteSetup, navigationHistory, navigationSnapshot,
  stationaryWithoutGps, temperatureHistory, tireForecast, visitedLocations, zeroDetectorSnapshot,
} from './specialized.fixtures';

type Theme = 'dark' | 'light';
type ResponseFactory = () => { status: number; json: unknown };

async function exactGet(
  page: Page,
  mocks: MockApiController | null,
  pathname: string,
  response: ResponseFactory,
  requiredQuery: Readonly<Record<string, string>> = {},
): Promise<void> {
  await page.route(url => url.pathname === `/api/v1${pathname}`, async route => {
    const request = route.request();
    expect(request.method(), pathname).toBe('GET');
    const url = new URL(request.url());
    for (const [key, value] of Object.entries(requiredQuery)) {
      expect(url.searchParams.get(key), `${pathname} query ${key}`).toBe(value);
    }
    const fixture = response();
    await fulfillApiFixture(route, mocks, {
      status: fixture.status, contentType: 'application/json',
      body: JSON.stringify(fixture.json),
    });
  });
}

async function start(page: Page, theme: Theme, width: number, route: string) {
  await page.setViewportSize({ width, height: 900 });
  await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
  await seedBrowserState(page, theme, route);
  const diagnostics = monitorPage(page);
  const mocks = await installApiMocks(page, 'populated', theme);
  expect(mocks, 'specialized fixture contracts require strict mocked mode').not.toBeNull();
  return { mocks, diagnostics };
}

async function ready(page: Page, mocks: MockApiController | null, theme: Theme) {
  await waitForHarnessReady(page, mocks);
  await expectThemeApplied(page, theme);
}

async function metric(brief: Locator, key: string, value: string | RegExp, state = 'value') {
  const item = brief.locator(`[data-operational-metric="${key}"]`);
  await expect(item).toHaveAttribute('data-value-state', state);
  await expect(item.locator('[data-operational-value]')).toHaveText(value);
}

async function review(page: Page, brief: Locator, title: string, evidence: readonly string[]) {
  await expect(brief).toHaveAttribute('data-operational-brief', 'true');
  const before = await brief.locator('[data-operational-metric]').allTextContents();
  const trigger = brief.getByRole('button', { name: 'Review details', exact: true });
  await trigger.focus();
  await trigger.press('Enter');
  const drawer = page.getByRole('dialog', { name: `${title} details`, exact: true });
  await expect(drawer).toBeVisible();
  await expect(drawer).toHaveAttribute('aria-modal', 'true');
  await expect(drawer.getByRole('heading', { name: 'Operational metrics', exact: true })).toBeVisible();
  for (const text of evidence) await expect(drawer).toContainText(text);
  await expectDialogsInsideViewport(page);
  const close = drawer.getByRole('button', { name: 'Close', exact: true });
  await close.first().focus();
  await page.keyboard.press('Shift+Tab');
  await expect(close.last()).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(close.first()).toBeFocused();
  await expectNoHorizontalOverflow(page);
  await page.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);
  await expect(trigger).toBeFocused();
  expect(await brief.locator('[data-operational-metric]').allTextContents()).toEqual(before);
}

for (const theme of ['dark', 'light'] as const) {
  for (const width of [320, 1440]) {
    test(`specialized explore catalog, filter zero and navigation ${theme} ${width}`, async ({ page }) => {
      const { mocks, diagnostics } = await start(page, theme, width, '/explore');
      await exactGet(page, mocks, '/analytics/anomalies', () => ({ status: 200, json: detectorSnapshot }), { vehicle_id: '7', days: '7' });
      await page.goto('/explore');
      await ready(page, mocks, theme);
      const brief = page.getByTestId('explore-operational-brief');
      await metric(brief, 'vehicles', '1');
      const total = await brief.locator('[data-operational-metric="features"] [data-operational-value]').innerText();
      await metric(brief, 'showing', total);
      await expect(brief).toContainText('no date window');
      await review(page, brief, 'Feature overview', [
        'Catalog counts are derived, not vehicle telemetry.',
        'Vehicles in the returned fleet list',
        'Visible catalog entries after vehicle and authentication gates',
      ]);
      await page.getByRole('searchbox', { name: 'Filter features', exact: true }).fill('zzzz-no-matching-destination');
      await metric(brief, 'showing', '0');
      await metric(brief, 'features', total);
      await metric(brief, 'vehicles', '1');
      await expect(page).toHaveURL(/q=zzzz-no-matching-destination/);
      await page.getByRole('searchbox', { name: 'Filter features', exact: true }).fill('Anomaly detection');
      const destination = page.locator('main a[href="/anomaly-detection"]').first();
      await expect(destination).toBeVisible();
      await destination.click();
      await expect(page).toHaveURL(/\/anomaly-detection$/);
      await expect(page.getByTestId('anomaly-summary')).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await expectNoRuntimeFailures(diagnostics);
      await assertMockApiComplete(page, mocks);
    });

    test(`specialized static SQL and Grafana briefs retain editors ${theme} ${width}`, async ({ page }) => {
      const { mocks, diagnostics } = await start(page, theme, width, '/power/sql');
      await page.goto('/power/sql');
      await ready(page, mocks, theme);
      const sqlBrief = page.getByTestId('power-sql-catalog-brief');
      await metric(sqlBrief, 'tables', String(CURATED_CATALOG.length));
      await metric(sqlBrief, 'columns', String(CURATED_CATALOG.reduce((sum, table) => sum + table.columns.length, 0)));
      await metric(sqlBrief, 'access', 'Read-only');
      await metric(sqlBrief, 'units', 'SI units');
      await expect(sqlBrief).toContainText('m · s · Wh');
      const editor = page.getByRole('textbox', { name: 'SQL query editor', exact: true });
      await editor.fill('SELECT distance_m, duration_s, energy_used_wh FROM drives LIMIT 10;');
      await review(page, sqlBrief, 'Catalog overview', [
        'no query has been executed', 'across all tables', 'm · s · Wh',
      ]);
      await expect(editor).toHaveValue('SELECT distance_m, duration_s, energy_used_wh FROM drives LIMIT 10;');
      await page.getByRole('button', { name: 'Run', exact: true }).click();
      await expect(page.getByText('Read-only execution from the browser is not enabled in this build.', { exact: false })).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await page.goto('/power/grafana');
      await ready(page, mocks, theme);
      const grafanaBrief = page.getByTestId('power-grafana-catalog-brief');
      await metric(grafanaBrief, 'panel-types', '8');
      await metric(grafanaBrief, 'datasources', '2');
      await metric(grafanaBrief, 'tables', '5');
      await metric(grafanaBrief, 'columns', '33');
      const panelEditor = page.getByRole('textbox', { name: 'Grafana panel JSON editor', exact: true });
      await panelEditor.fill('{"title":"SI distance","type":"timeseries","targets":[]}');
      await review(page, grafanaBrief, 'Curated catalog summary', [
        'not a live connectivity check', 'browser never pushes panels to Grafana',
        'Documented columns across all bundled curated tables.',
      ]);
      await expect(panelEditor).toHaveValue('{"title":"SI distance","type":"timeseries","targets":[]}');
      await page.getByRole('button', { name: 'Clear', exact: true }).click();
      await expect(panelEditor).toHaveValue('');
      await metric(grafanaBrief, 'panel-types', '8');
      await expectNoHorizontalOverflow(page);
      await expectNoRuntimeFailures(diagnostics);
      await assertMockApiComplete(page, mocks);
    });

    test(`specialized anomaly source windows and measured zero ${theme} ${width}`, async ({ page }) => {
      const { mocks, diagnostics } = await start(page, theme, width, '/anomaly-detection');
      await exactGet(page, mocks, '/analytics/anomalies', () => ({ status: 200, json: detectorSnapshot }), { vehicle_id: '7', days: '7' });
      await page.goto('/anomaly-detection');
      await ready(page, mocks, theme);
      const brief = page.getByTestId('anomaly-summary');
      await metric(brief, 'anomaly-monitored', '42');
      await metric(brief, 'anomaly-7d', '5');
      await metric(brief, 'anomaly-24h', '0');
      await metric(brief, 'anomaly-health-categories', '3');
      await expect(brief).toContainText('Current snapshot · last 7 days · last 24 hours');
      await review(page, brief, 'Coverage and anomaly windows', [
        'separate 7-day and 24-hour source windows', 'Current detector snapshot', 'Last 24 hours',
      ]);
      await expect(page.getByRole('heading', { name: 'Most frequent anomalies', exact: true })).toBeVisible();
      await expect(page.getByText('Battery drift', { exact: true })).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await expectNoRuntimeFailures(diagnostics);
      await assertMockApiComplete(page, mocks);
    });

    test(`specialized locations loaded-page SI durations and unchanged filtered totals ${theme} ${width}`, async ({ page }) => {
      const path = '/locations?from=2025-03-01&to=2025-03-31';
      const { mocks, diagnostics } = await start(page, theme, width, path);
      await exactGet(page, mocks, '/locations', () => ({ status: 200, json: visitedLocations }), {
        vehicle_id: '7', limit: '50', offset: '0',
        from: '2025-03-01T00:00:00.000Z', to: '2025-04-01T00:00:00.000Z',
      });
      await page.goto(path);
      await ready(page, mocks, theme);
      const brief = page.getByRole('region', { name: 'Location summary', exact: true });
      await metric(brief, 'locations-places', '2');
      await metric(brief, 'locations-cities', '2');
      await metric(brief, 'locations-visits', '35');
      await metric(brief, 'locations-time', /^21\.00\s*h$/);
      await metric(brief, 'locations-top', 'Home, Seattle');
      await expect(brief).toContainText('loaded page 1, up to 50 places; not server-wide totals.');
      await review(page, brief, 'Location summary', [
        'Home, Seattle', 'Loaded-page total duration divided by loaded-page visits',
        'search does not recalculate the summary', 'historical',
      ]);
      await expect(page.getByRole('region', { name: 'Top locations', exact: true })).toBeVisible();
      const search = page.getByPlaceholder('Search by address…', { exact: true });
      await search.fill('Office');
      await metric(brief, 'locations-visits', '35');
      await metric(brief, 'locations-top', 'Home, Seattle');
      await expectNoHorizontalOverflow(page);
      await expectNoRuntimeFailures(diagnostics);
      await assertMockApiComplete(page, mocks);
    });

    test(`specialized route SI bridge, independent source zero and false presence ${theme} ${width}`, async ({ page }) => {
      const { mocks, diagnostics } = await start(page, theme, width, '/navigation');
      await exactGet(page, mocks, '/location-snapshots/latest', () => ({ status: 200, json: navigationSnapshot }), { vehicle_id: '7' });
      await exactGet(page, mocks, '/location-snapshots', () => ({ status: 200, json: navigationHistory }), { vehicle_id: '7', limit: '200' });
      await exactGet(page, mocks, '/charging-telemetry/latest', () => ({ status: 200, json: arrivalTelemetry }), { vehicle_id: '7' });
      await page.goto('/navigation');
      await ready(page, mocks, theme);
      const route = page.getByRole('region', { name: 'Route metrics', exact: true });
      await metric(route, 'navigation-distance', /^9\.00\s*km$/);
      await metric(route, 'navigation-eta', /^20\.00\s*min$/);
      await metric(route, 'navigation-average', /^72\.00\s*km\/h$/);
      await metric(route, 'navigation-delay', /^0/);
      await metric(route, 'navigation-arrival', '0.00%');
      await expect(route).toContainText('no common source window');
      await review(page, route, 'Route metrics', [
        'Source ETA is in minutes', 'independent charging telemetry',
        'unknown differs from measured no delay', 'latest 200 snapshots',
      ]);
      const presence = page.getByRole('region', { name: 'Location status', exact: true });
      await metric(presence, 'navigation-home', 'Away');
      await metric(presence, 'navigation-work', 'Away');
      await metric(presence, 'navigation-heading', 'N (0°)');
      await review(page, presence, 'Location status', [
        'False is a reported away state; missing presence is unknown.',
        '37.1', '-122.1', 'live',
      ]);
      await expectNoHorizontalOverflow(page);
      await expectNoRuntimeFailures(diagnostics);
      await assertMockApiComplete(page, mocks);
    });

    test(`specialized onboarding durable completion during telemetry outage ${theme} ${width}`, async ({ page }) => {
      const { mocks, diagnostics } = await start(page, theme, width, '/onboarding');
      await exactGet(page, mocks, '/onboarding/status', () => ({ status: 200, json: durableSetupDuringOutage }));
      await page.goto('/onboarding');
      await ready(page, mocks, theme);
      const brief = page.getByTestId('onboarding-setup-brief');
      await metric(brief, 'setup-progress', '3/3');
      await metric(brief, 'vehicles', '1');
      await metric(brief, 'tesla', 'Not connected');
      await metric(brief, 'telemetry', 'Interrupted');
      await expect(brief).toContainText('All steps complete');
      await review(page, brief, 'Setup status', [
        'completed setup remains complete during a live-service outage',
        'Telemetry health is not a status-fetch timestamp', 'Stored history remains available',
      ]);
      await expectNoHorizontalOverflow(page);
      await expectNoRuntimeFailures(diagnostics);
      await assertMockApiComplete(page, mocks);
    });

    test(`specialized empty geofence counts preserve form controls ${theme} ${width}`, async ({ page }) => {
      const { mocks, diagnostics } = await start(page, theme, width, '/geofences');
      for (const path of ['/geofences', '/geofences/visited-candidates', '/geofences/needs-review', '/geofences/rates/current']) {
        await exactGet(page, mocks, path, () => ({ status: 200, json: [] }));
      }
      await page.goto('/geofences');
      await ready(page, mocks, theme);
      const brief = page.getByRole('region', { name: 'Geofence summary', exact: true });
      for (const key of ['geofences-total', 'geofences-reviewed', 'geofences-pending', 'geofences-candidates']) {
        await metric(brief, key, '0');
      }
      await expect(brief).toContainText('not limited to the selected vehicle');
      await review(page, brief, 'Geofence summary', [
        'Saved geofences and visited candidates are independent sources',
        'Returned visited-place candidates; separate from saved geofence totals.',
      ]);
      await page.getByRole('button', { name: 'Add geofence', exact: true }).click();
      const form = page.getByRole('dialog', { name: 'Create geofence', exact: true });
      await expect(form).toBeVisible();
      await expect(form.getByLabel('Name', { exact: true })).toBeVisible();
      await expect(form.getByLabel('Radius (meters)', { exact: true })).toHaveValue('100');
      await expectDialogsInsideViewport(page);
      await page.keyboard.press('Escape');
      await expect(form).toHaveCount(0);
      await metric(brief, 'geofences-total', '0');
      await expectNoHorizontalOverflow(page);
      await expectNoRuntimeFailures(diagnostics);
      await assertMockApiComplete(page, mocks);
    });

    test(`specialized live-position measured stationary zero is not valid GPS ${theme} ${width}`, async ({ page }) => {
      const { mocks, diagnostics } = await start(page, theme, width, '/live');
      await page.route(url => url.pathname === '/api/v1/vehicles/7/positions', async route => {
        expect(route.request().method()).toBe('GET');
        const limit = new URL(route.request().url()).searchParams.get('limit');
        expect(['1', '50']).toContain(limit);
        await fulfillApiFixture(route, mocks, {
          status: 200, contentType: 'application/json',
          body: JSON.stringify([stationaryWithoutGps]),
        });
      });
      await exactGet(page, mocks, '/location-snapshots/latest', () => ({ status: 200, json: null }), { vehicle_id: '7' });
      await page.goto('/live');
      await ready(page, mocks, theme);
      const brief = page.getByRole('region', { name: 'Vehicle status', exact: true });
      await metric(brief, 'overview-speed', /^0\.00\s*km\/h$/);
      await metric(brief, 'overview-heading', '0.00°');
      await metric(brief, 'overview-latitude', '—', 'missing');
      await metric(brief, 'overview-longitude', '—', 'missing');
      await expect(brief).toContainText('latest position only');
      await review(page, brief, 'Vehicle status', [
        'missing GPS is not a measured zero', 'Reported heading in degrees.',
        'Auto-refreshes every 15 s', 'live',
      ]);
      await expect(page.locator('.leaflet-container')).toHaveCount(0);
      await expectNoHorizontalOverflow(page);
      await expectNoRuntimeFailures(diagnostics);
      await assertMockApiComplete(page, mocks);
    });

    test(`specialized temperature efficiency and independent monthly diagnosis ${theme} ${width}`, async ({ page }) => {
      const { mocks, diagnostics } = await start(page, theme, width, '/temperature-impact');
      await exactGet(page, mocks, '/analytics/temperature-impact', () => ({ status: 200, json: temperatureHistory }), { vehicle_id: '7' });
      await exactGet(page, mocks, '/analytics/temperature-impact/shift', () => ({ status: 200, json: efficiencyShift }), { vehicle_id: '7' });
      await page.goto('/temperature-impact');
      await ready(page, mocks, theme);
      const brief = page.getByRole('region', { name: 'Summary metrics', exact: true });
      await metric(brief, 'temperature-average', /^185\.00\s*Wh\/km$/);
      await metric(brief, 'temperature-best', '10–20°C');
      await metric(brief, 'temperature-worst', '> 30°C');
      await metric(brief, 'temperature-points', '2');
      await metric(brief, 'temperature-best-efficiency', /^150\.00\s*Wh\/km$/);
      await metric(brief, 'temperature-worst-efficiency', /^220\.00\s*Wh\/km$/);
      await expect(brief).toContainText('source window unspecified');
      await review(page, brief, 'Summary metrics', [
        'Monthly trend and efficiency detective use independent periods.',
        'Lowest average consumption among populated temperature buckets.',
      ]);
      const detective = page.getByRole('region', { name: 'Month-over-month diagnosis', exact: true });
      await metric(detective, 'detective-delta', '15.00%');
      await metric(detective, 'detective-attributed', '12.00%');
      await metric(detective, 'detective-temperature', '-8.00°C');
      await expect(detective).toContainText('2025-12 versus 2025-11');
      await review(page, detective, 'Month-over-month diagnosis', [
        'independent server diagnosis', 'not an absolute temperature conversion',
        'temperature-attributed', 'Efficiency detective:',
      ]);
      await expectNoHorizontalOverflow(page);
      await expectNoRuntimeFailures(diagnostics);
      await assertMockApiComplete(page, mocks);
    });

    test(`specialized next-service projection keeps its forecast and gauge basis ${theme} ${width}`, async ({ page }) => {
      const { mocks, diagnostics } = await start(page, theme, width, '/diagnostics/rul');
      await exactGet(page, mocks, '/vehicles/7/rul', () => ({ status: 200, json: componentBoard }));
      await exactGet(page, mocks, '/vehicles/7/rul/tires', () => ({ status: 200, json: tireForecast }));
      await page.goto('/diagnostics/rul');
      await ready(page, mocks, theme);
      const brief = page.getByTestId('rul-next-service-summary');
      await metric(brief, 'rul-next-service-component', 'Tires');
      await metric(brief, 'rul-next-service-date', '2026-08-01');
      await expect(brief).toContainText('Board snapshot; no observation timestamp supplied');
      await review(page, brief, 'Next service due', [
        'not a guaranteed failure date',
        'component forecasts retain their own confidence and basis below',
        'Existing next-service projection from the component health board.',
      ]);
      const component = page.getByRole('option', { name: 'Show forecast for Tires', exact: true });
      await expect(component).toHaveAttribute('aria-selected', 'true');
      await expect(page.getByText('Measured tread trend', { exact: true })).toBeVisible();
      await expect(page.getByRole('heading', { name: /Health forecast/ })).toBeVisible();
      await component.click();
      await expect(component).toHaveAttribute('aria-selected', 'true');
      await expectNoHorizontalOverflow(page);
      await expectNoRuntimeFailures(diagnostics);
      await assertMockApiComplete(page, mocks);
    });

    test(`specialized home-energy no-history modeled zeros retain assumptions ${theme} ${width}`, async ({ page }) => {
      const { mocks, diagnostics } = await start(page, theme, width, '/energy-orchestrator');
      await exactGet(page, mocks, '/vehicles', () => ({ status: 200, json: [] }));
      await exactGet(page, mocks, '/tesla/energy-sites', () => ({ status: 200, json: [] }));
      await page.goto('/energy-orchestrator');
      await ready(page, mocks, theme);
      const outcomes = page.getByTestId('home-energy-outcomes');
      await metric(outcomes, 'vehicles-ready', '0/0');
      await metric(outcomes, 'peak-grid-import', /^0\.00\s*kW$/);
      await metric(outcomes, 'unmet-energy', /^0\.00\s*kWh$/);
      await metric(outcomes, 'projected-cost', '$0.00');
      await expect(outcomes).toContainText('15-minute modeled slots · UTC · source coverage not established');
      const interval = (await outcomes.innerText()).match(/Planning horizon: (\S+) — (\S+) \(end exclusive\)/);
      expect(interval, 'actual modeled interval must expose both exclusive bounds').not.toBeNull();
      if (!interval) throw new Error('Planning interval is missing');
      expect(Date.parse(interval[2]) - Date.parse(interval[1])).toBe(24 * 3_600_000);
      await review(page, outcomes, 'Planning outcomes', [
        'Modeled recommendation score, not source confidence',
        'raw input in watts', 'raw input in watt-hours',
        'TeslaSync has no endpoint that reports these as measured fact.',
      ]);
      const quality = page.getByTestId('home-energy-forecast-quality');
      await metric(quality, 'solar-confidence', '0%');
      await metric(quality, 'load-confidence', '0%');
      await expect(quality).toContainText('0% confidence from 0 history sample(s)');
      await review(page, quality, 'Assumptions & forecast quality', [
        'No history', 'No source history sample timestamp is available.',
        'not confidence in measured vehicle or battery state.',
      ]);
      for (const title of [
        'Scenario & assumptions', 'Vehicle assumptions', 'Energy flow schedule',
        'Per-vehicle readiness', 'Powerwall trajectory', 'Tariff & constraint heatmap',
        'Constraint violations', 'Export plan',
      ]) await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
      await expect(page.getByText('Missing vehicle or home-battery SoC uses a 50% model assumption, not a measurement.', { exact: false })).toBeVisible();
      await page.getByRole('button', { name: 'Reset to defaults', exact: true }).click();
      await metric(outcomes, 'vehicles-ready', '0/0');
      await metric(quality, 'solar-confidence', '0%');
      await expectNoHorizontalOverflow(page);
      await expectNoRuntimeFailures(diagnostics);
      await assertMockApiComplete(page, mocks);
    });

    test(`specialized vault absent evidence keeps all seven briefs and disclosure controls ${theme} ${width}`, async ({ page }) => {
      test.setTimeout(120_000);
      const { mocks, diagnostics } = await start(page, theme, width, '/resale-vault');
      for (const path of ['/maintenance', '/maintenance/records']) {
        await exactGet(page, mocks, path, () => ({ status: 200, json: [] }));
      }
      await exactGet(page, mocks, '/software-updates', () => ({ status: 200, json: [] }), { vehicle_id: '7' });
      for (const path of ['/drives', '/charging']) {
        await exactGet(page, mocks, path, () => ({ status: 200, json: [] }), { vehicle_id: '7', limit: '1000' });
      }
      for (const path of [
        '/vehicles/7/battery-passport', '/vehicles/7/warranty',
      ]) await exactGet(page, mocks, path, () => ({ status: 200, json: null }));
      for (const path of ['/drives/stats', '/drives/score', '/analytics/battery-health/certificate']) {
        await exactGet(page, mocks, path, () => ({ status: 200, json: null }), { vehicle_id: '7' });
      }
      await exactGet(page, mocks, '/vehicles/7/guard/events', () => ({
        status: 200, json: { vehicle_id: 7, events: [] },
      }));
      await page.goto('/resale-vault');
      await ready(page, mocks, theme);
      const bands = [
        { id: 'battery', title: 'Battery measurements', keys: ['soh', 'capacity', 'original-capacity', 'cycles', 'fast-charge-ratio', 'charge-limit'] },
        { id: 'certificate', title: 'Certificate measurements', keys: ['certificate-soh', 'certificate-capacity', 'certificate-cycles', 'certificate-habits'] },
        { id: 'maintenance', title: 'Maintenance record counts', keys: ['scheduled-items', 'service-records'] },
        { id: 'software', title: 'Observed software history', keys: ['updates'] },
        { id: 'driving', title: 'Driving', keys: ['drives', 'distance', 'duration', 'efficiency', 'regen', 'co2'] },
        { id: 'charging', title: 'Charging', keys: ['sessions', 'energy-added', 'fast-charge-sessions', 'peak-power', 'cost'] },
        { id: 'incidents', title: 'Observed security history', keys: ['events', 'acknowledged'] },
      ];
      await expect(page.locator('main [data-operational-brief]')).toHaveCount(7);
      for (const band of bands) {
        const brief = page.getByTestId(`vault-${band.id}-brief`);
        await expect(brief).toContainText('No evidence supplied');
        await expect(brief.locator('[data-operational-metric]')).toHaveCount(band.keys.length);
        for (const key of band.keys) await metric(brief, key, '—', 'missing');
        await review(page, brief, band.title, ['No measurement supplied']);
      }
      await expect(page.getByTestId('vault-charging-brief')).toContainText('the source does not supply a currency denomination');
      const before = await page.locator('main [data-operational-metric]').allTextContents();
      await page.getByRole('tab', { name: 'Disclosure profile', exact: true }).click();
      await expect(page.getByRole('tab', { name: 'Disclosure profile', exact: true })).toHaveAttribute('aria-selected', 'true');
      await expect(page.locator('main [data-operational-brief]')).toHaveCount(0);
      await page.getByRole('tab', { name: 'Evidence', exact: true }).click();
      await expect(page.locator('main [data-operational-brief]')).toHaveCount(7);
      expect(await page.locator('main [data-operational-metric]').allTextContents()).toEqual(before);
      expect(mocks?.requests.filter(request => request.path.startsWith('/api/v1/public/battery-certificate/verify'))).toEqual([]);
      await expectNoHorizontalOverflow(page);
      await expectNoRuntimeFailures(diagnostics);
      await assertMockApiComplete(page, mocks);
    });
  }
}

for (const source of ['zero', 'unknown'] as const) {
  test(`specialized detector ${source} remains distinct from absent measurements`, async ({ page }) => {
    const { mocks } = await start(page, 'dark', 320, '/analytics/anomalies');
    await exactGet(page, mocks, '/analytics/anomalies', () => ({
      status: 200, json: source === 'zero' ? zeroDetectorSnapshot : null,
    }), { vehicle_id: '7', days: '7' });
    await page.goto('/analytics/anomalies');
    await ready(page, mocks, 'dark');
    const brief = page.getByTestId('anomaly-summary');
    for (const key of ['anomaly-monitored', 'anomaly-7d', 'anomaly-24h', 'anomaly-health-categories']) {
      await metric(brief, key, source === 'zero' ? '0' : '—', source === 'zero' ? 'value' : 'missing');
    }
    await expect(brief).toContainText(source === 'zero' ? 'Detector snapshot available' : 'Detector snapshot unavailable');
    await review(page, brief, 'Coverage and anomaly windows', ['Current detector snapshot', 'Last 7 days']);
    await expectNoHorizontalOverflow(page);
    await assertMockApiComplete(page, mocks);
  });

  test(`specialized route stationary ${source} speed and independent missing arrival`, async ({ page }) => {
    const { mocks } = await start(page, 'light', 320, '/navigation');
    const snapshot = source === 'zero' ? {
      ...navigationSnapshot, speed_mph: 0, miles_to_arrival: 0,
      minutes_to_arrival: 0, route_traffic_delay_s: 0,
    } : { id: 11, created_at: navigationSnapshot.created_at };
    await exactGet(page, mocks, '/location-snapshots/latest', () => ({ status: 200, json: snapshot }), { vehicle_id: '7' });
    await exactGet(page, mocks, '/location-snapshots', () => ({ status: 200, json: [snapshot] }), { vehicle_id: '7', limit: '200' });
    await exactGet(page, mocks, '/charging-telemetry/latest', () => ({ status: 200, json: null }), { vehicle_id: '7' });
    await page.goto('/navigation');
    await ready(page, mocks, 'light');
    const brief = page.getByRole('region', { name: 'Route metrics', exact: true });
    await metric(brief, 'navigation-average', source === 'zero' ? /^0\.00\s*km\/h$/ : '—', source === 'zero' ? 'value' : 'missing');
    await metric(brief, 'navigation-distance', source === 'zero' ? /^0\.00\s*km$/ : '—', source === 'zero' ? 'value' : 'missing');
    await metric(brief, 'navigation-arrival', '—', 'missing');
    await expect(brief).toContainText('Independent sources incomplete');
    await expectNoHorizontalOverflow(page);
    await assertMockApiComplete(page, mocks);
  });
}

test('specialized first-run measured zero keeps setup checklist and account navigation', async ({ page }) => {
  const { mocks } = await start(page, 'light', 320, '/onboarding');
  await exactGet(page, mocks, '/onboarding/status', () => ({ status: 200, json: incompleteSetup }));
  await page.goto('/onboarding');
  await ready(page, mocks, 'light');
  const brief = page.getByTestId('onboarding-setup-brief');
  await metric(brief, 'vehicles', '0');
  await metric(brief, 'setup-progress', '0/3');
  await expect(page.getByRole('link', { name: 'Connect Tesla account', exact: true })).toHaveAttribute('href', '/tesla-account');
  await expect(brief).toContainText('This installation · 3 setup anchors');
  await review(page, brief, 'Setup status', ['Waiting for the first sync', 'No signals received yet']);
  await expectNoHorizontalOverflow(page);
  await assertMockApiComplete(page, mocks);
});

test('specialized feature hub missing fleet does not masquerade as a measured empty fleet', async ({ page }) => {
  test.setTimeout(90_000);
  const { mocks } = await start(page, 'dark', 320, '/explore');
  await exactGet(page, mocks, '/vehicles', () => ({
    status: 503, json: { error: 'Fleet fixture unavailable' },
  }));
  await page.goto('/explore');
  const brief = page.getByTestId('explore-operational-brief');
  await expect(brief).toContainText('Fleet unavailable', { timeout: 45_000 });
  await expectThemeApplied(page, 'dark');
  await metric(brief, 'vehicles', '—', 'missing');
  await expect(brief).toContainText('No fleet list is available');
  await expect(brief.locator('[data-operational-metric="features"]')).toHaveAttribute('data-value-state', 'value');
  await expect(page.getByRole('searchbox', { name: 'Filter features', exact: true })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await assertMockApiComplete(page, mocks);
});

test('specialized feature hub successful empty fleet is a measured zero', async ({ page }) => {
  const { mocks } = await start(page, 'light', 320, '/explore');
  await exactGet(page, mocks, '/vehicles', () => ({ status: 200, json: [] }));
  await page.goto('/explore');
  await ready(page, mocks, 'light');
  const brief = page.getByTestId('explore-operational-brief');
  await metric(brief, 'vehicles', '0');
  await expect(brief).toContainText('Catalog ready');
  await expect(brief.locator('[data-operational-metric="features"]')).toHaveAttribute('data-value-state', 'value');
  await expectNoHorizontalOverflow(page);
  await assertMockApiComplete(page, mocks);
});

test('specialized setup unavailable counts stay unknown until the real Retry succeeds', async ({ page }) => {
  test.setTimeout(90_000);
  const { mocks } = await start(page, 'light', 320, '/onboarding');
  let unavailable = true;
  await exactGet(page, mocks, '/onboarding/status', () => unavailable
    ? { status: 503, json: { error: 'Setup fixture unavailable' } }
    : { status: 200, json: incompleteSetup });
  await page.goto('/onboarding');
  const brief = page.getByTestId('onboarding-setup-brief');
  await expect(brief).toContainText('Setup status unavailable', { timeout: 45_000 });
  await metric(brief, 'setup-progress', '—', 'missing');
  await metric(brief, 'vehicles', '—', 'missing');
  await review(page, brief, 'Setup status', [
    'Setup status has not been received; no completed-step or vehicle count is known.',
  ]);
  unavailable = false;
  await brief.locator('xpath=..').getByRole('button', { name: 'Retry', exact: true }).click();
  await metric(brief, 'setup-progress', '0/3');
  await metric(brief, 'vehicles', '0');
  await expectNoHorizontalOverflow(page);
  await assertMockApiComplete(page, mocks);
});

test('specialized route explicit Refresh preserves published metrics through a source failure', async ({ page }) => {
  const { mocks, diagnostics } = await start(page, 'dark', 1440, '/navigation');
  let failRefresh = false;
  await exactGet(page, mocks, '/location-snapshots/latest', () => failRefresh
    ? { status: 503, json: { error: 'Navigation fixture refresh unavailable' } }
    : { status: 200, json: navigationSnapshot }, { vehicle_id: '7' });
  await exactGet(page, mocks, '/location-snapshots', () => ({ status: 200, json: navigationHistory }), { vehicle_id: '7', limit: '200' });
  await exactGet(page, mocks, '/charging-telemetry/latest', () => ({ status: 200, json: arrivalTelemetry }), { vehicle_id: '7' });
  await page.goto('/navigation');
  await ready(page, mocks, 'dark');
  const brief = page.getByRole('region', { name: 'Route metrics', exact: true });
  await metric(brief, 'navigation-distance', /^9\.00\s*km$/);
  failRefresh = true;
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(brief).toContainText('Retained source data', { timeout: 20_000 });
  await metric(brief, 'navigation-distance', /^9\.00\s*km$/);
  await metric(brief, 'navigation-average', /^72\.00\s*km\/h$/);
  await review(page, brief, 'Route metrics', ['Retained source data', 'Navigation: live', 'Location history: historical']);
  failRefresh = false;
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(brief).toContainText('Source data available', { timeout: 20_000 });
  await expectNoHorizontalOverflow(page);
  expect(diagnostics.pageErrors).toEqual([]);
  await assertMockApiComplete(page, mocks);
});
