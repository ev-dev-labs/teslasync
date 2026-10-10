import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  assertMockApiComplete, expectThemeApplied, fulfillApiFixture, installApiMocks,
  mockAppSettings, seedBrowserState, waitForHarnessReady,
} from '../mockApi';
import {
  expectDialogsInsideViewport, expectNoHorizontalOverflow,
  expectNoRuntimeFailures, monitorPage,
} from '../qualityAssertions';
import { ROUTE_REGISTRY } from '../../src/lib/routeRegistry';
import { formatDateTime } from '../../src/lib/dateFormat';
import {
  SCIENCE_DOMAINS, SCIENCE_END, SCIENCE_ROUTE, SCIENCE_START,
  electrochemFixture, notebookFixture, scienceResponses,
  thermalFixture, tiresFixture, weatherFixture,
  type ScienceCase, type ScienceDomain,
} from './science.fixtures';

test.use({ locale: 'en-US', timezoneId: 'UTC' });

const BRIEFS = [
  'science-evidence-brief', 'science-electrochem-brief', 'science-arrhenius-brief',
  'science-aging-brief', 'science-weather-brief', 'science-tires-brief',
] as const;
type BriefId = typeof BRIEFS[number];
type DisplayUnits = 'metric' | 'imperial';
interface ScienceRequest {
  domain: ScienceDomain;
  start: string;
  end: string;
}

function metric(page: Page, brief: BriefId, occurrence: string): Locator {
  return page.getByTestId(brief).locator(`[data-operational-metric="${occurrence}"]`);
}

async function expectMetric(
  page: Page, brief: BriefId, occurrence: string, value: string,
  state: 'value' | 'missing' = 'value',
): Promise<void> {
  const item = metric(page, brief, occurrence);
  await expect(item).toHaveAttribute('data-value-state', state);
  await expect(item.locator('[data-operational-value]')).toHaveText(value);
}

async function openReview(page: Page, brief: BriefId): Promise<Locator> {
  const trigger = page.getByTestId(brief).getByRole('button', { name: 'Review details', exact: true });
  await trigger.scrollIntoViewIfNeeded();
  await trigger.focus();
  await trigger.press('Enter');
  const drawer = page.getByRole('dialog');
  await expect(drawer).toHaveCount(1);
  await expect(drawer).toBeVisible();
  await expect(drawer).toHaveAttribute('aria-modal', 'true');
  await expect(drawer.getByRole('heading', { name: 'Operational metrics', exact: true })).toBeVisible();
  await expect(drawer).toContainText('Not scored');
  await expect(drawer.getByTestId('calculation-details')).toContainText('Historical inputs and derived fits');
  await expectDialogsInsideViewport(page);
  const close = drawer.getByRole('button', { name: 'Close', exact: true });
  await close.first().focus();
  await page.keyboard.press('Shift+Tab');
  await expect(close.last()).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(close.first()).toBeFocused();
  await expectNoHorizontalOverflow(page);
  return drawer;
}

async function closeReview(page: Page, brief: BriefId): Promise<void> {
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByTestId(brief).getByRole('button', { name: 'Review details', exact: true })).toBeFocused();
}

async function bootScience(
  page: Page, theme: 'light' | 'dark', width: number, mode: ScienceCase,
  units: DisplayUnits = 'metric', pendingWeather?: Promise<void>,
) {
  expect(ROUTE_REGISTRY.find((route) => route.path === '/science')?.name).toBe('ScienceLab');
  await page.setViewportSize({ width, height: 1000 });
  await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
  await seedBrowserState(page, theme, '/science');
  const diagnostics = monitorPage(page);
  const controller = await installApiMocks(page, 'populated', theme);
  if (!controller) throw new Error('Science preservation contracts require the strict mocked API harness');
  const reports = scienceResponses(mode);
  const requests: ScienceRequest[] = [];
  await page.route(/\/api\/v1\/settings(?:\?|$)/, async (route) => {
    expect(route.request().method()).toBe('GET');
    await fulfillApiFixture(route, controller, {
      json: {
        ...mockAppSettings, theme_mode: theme,
        unit_of_length: units === 'imperial' ? 'mi' : 'km',
        unit_of_temp: units === 'imperial' ? 'F' : 'C',
        unit_of_pressure: units === 'imperial' ? 'psi' : 'bar',
      },
    });
  });
  for (const domain of SCIENCE_DOMAINS) {
    await page.route(new RegExp(`/api/v1/science/${domain}(?:\\?|$)`), async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      expect(request.method()).toBe('GET');
      expect(url.origin).toBe(new URL(page.url()).origin);
      expect(url.pathname).toBe(`/api/v1/science/${domain}`);
      expect([...url.searchParams.keys()].sort()).toEqual(['end', 'start', 'vehicle_id']);
      expect(url.searchParams.get('vehicle_id')).toBe('7');
      const start = url.searchParams.get('start');
      const end = url.searchParams.get('end');
      if (!start || !end) throw new Error('Science request lost its source window');
      expect(Date.parse(end)).toBeGreaterThan(Date.parse(start));
      requests.push({ domain, start, end });
      if (domain === 'weather' && pendingWeather) await pendingWeather;
      await fulfillApiFixture(route, controller, { json: reports[domain] });
    });
  }
  await page.goto(SCIENCE_ROUTE);
  if (pendingWeather) {
    await expectMetric(page, 'science-electrochem-brief', 'rest-points', '2');
    await expect(page.getByTestId('science-weather-brief')).toHaveAttribute('aria-busy', 'true');
  } else {
    await waitForHarnessReady(page, controller);
  }
  await expectThemeApplied(page, theme);
  for (const domain of SCIENCE_DOMAINS) {
    await expect.poll(() => requests.some((request) => request.domain === domain
      && request.start === SCIENCE_START && request.end === SCIENCE_END),
    { message: `${domain} did not receive the actual initial vehicle/window` }).toBe(true);
  }
  for (const id of BRIEFS) {
    await expect(page.getByTestId(id)).toHaveAttribute('data-operational-brief', 'true');
    await expect(page.getByTestId(id).getByRole('button', { name: 'Review details', exact: true })).toBeVisible();
    await expect(page.getByTestId(id)).toContainText('Vehicle 7');
  }
  await expect(page.getByRole('button', { name: 'Copy link to this view', exact: true })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  return { controller, diagnostics, requests };
}

async function expectOverview(page: Page): Promise<void> {
  await expectMetric(page, 'science-evidence-brief', 'science-electrochem', '2');
  await expectMetric(page, 'science-evidence-brief', 'science-resistance-steps', '2');
  await expectMetric(page, 'science-evidence-brief', 'science-thermal', '1');
  await expectMetric(page, 'science-evidence-brief', 'science-weather', '6');
  await expectMetric(page, 'science-evidence-brief', 'science-tires', '4');
  await expectMetric(page, 'science-evidence-brief', 'science-notebook', '2');
  await expect(metric(page, 'science-evidence-brief', 'science-tires')).toContainText('4 of 4 corners reported');
  await expect(metric(page, 'science-evidence-brief', 'science-notebook')).toContainText('2 of 3 rows with a result');
  await expect(metric(page, 'science-evidence-brief', 'science-thermal')).toContainText('1 qualified cooldown fits');
  await expect(page.getByTestId('science-evidence-brief')).toContainText('Independent reports');
  await expect(metric(page, 'science-evidence-brief', 'science-electrochem')).toContainText(electrochemFixture.honesty);
  await expect(metric(page, 'science-evidence-brief', 'science-thermal')).toContainText(thermalFixture.honesty);
  await expect(metric(page, 'science-evidence-brief', 'science-weather')).toContainText(weatherFixture.honesty);
  await expect(metric(page, 'science-evidence-brief', 'science-tires')).toContainText(tiresFixture.honesty);
  await expect(metric(page, 'science-evidence-brief', 'science-notebook')).toContainText(notebookFixture.honesty);
  for (const [domain, report] of [
    ['electrochem', electrochemFixture], ['thermal', thermalFixture],
    ['weather', weatherFixture], ['tires', tiresFixture], ['notebook', notebookFixture],
  ] as const) {
    const options = { tz: 'UTC', locale: 'en-US' };
    await expect(metric(page, 'science-evidence-brief', `science-${domain}`))
      .toContainText(`${formatDateTime(report.start, options)} → ${formatDateTime(report.end, options)}`);
  }
}

for (const theme of ['light', 'dark'] as const) {
  for (const width of [320, 1440]) {
    test(`science publishes independent peers without substituting zero for a pending source at ${width}px ${theme}`, async ({ page }) => {
      let releaseWeather: () => void = () => {};
      const pendingWeather = new Promise<void>((resolve) => { releaseWeather = resolve; });
      try {
        const { controller, diagnostics } = await bootScience(page, theme, width, 'populated', 'metric', pendingWeather);
        await expectMetric(page, 'science-evidence-brief', 'science-weather', '—', 'missing');
        await expect(metric(page, 'science-evidence-brief', 'science-weather')).toContainText('Awaiting a successful report');
        await expectMetric(page, 'science-evidence-brief', 'science-electrochem', '2');
        await expectMetric(page, 'science-tires-brief', 'front-left', '2.90 bar');
        await expect(page.getByTestId('science-evidence-brief')).not.toHaveAttribute('aria-busy');
        await expect(page.getByTestId('science-weather-brief').locator('[data-operational-value]')).toHaveCount(0);
        await expectNoHorizontalOverflow(page);
        releaseWeather();
        await waitForHarnessReady(page, controller);
        await expectOverview(page);
        await expectMetric(page, 'science-weather-brief', 'density-correlation', '0.00');
        await expectMetric(page, 'science-weather-brief', 'wind-correlation', '—', 'missing');
        await expect(page.getByTestId('science-weather-brief')).not.toHaveAttribute('aria-busy');
        await expectNoRuntimeFailures(diagnostics);
        await assertMockApiComplete(page, controller);
      } finally {
        releaseWeather();
      }
    });

    test(`science preserves six measured/inferred briefs, source denominators and drawers at ${width}px ${theme}`, async ({ page }) => {
      const { controller, diagnostics } = await bootScience(page, theme, width, 'populated');
      await expectOverview(page);
      await expectMetric(page, 'science-electrochem-brief', 'firmware', '2026.24.3');
      await expect(metric(page, 'science-electrochem-brief', 'firmware')).toContainText('Sample cap hit');
      await expect(page.getByTestId('science-electrochem-brief')).toContainText('Limited evidence');
      await expectMetric(page, 'science-arrhenius-brief', 'activation-energy', '8,314.00 J/mol');
      await expectMetric(page, 'science-arrhenius-brief', 'temperature-bins', '3.00');
      await expectMetric(page, 'science-arrhenius-brief', 'temperature-span', '10.00°C');
      await expectMetric(page, 'science-aging-brief', 'throughput', '50.00 kWh');
      await expectMetric(page, 'science-aging-brief', 'rest-duration', '40.00 h');
      await expectMetric(page, 'science-aging-brief', 'proxy-slope', '-12.00 Wh/day');
      await expectMetric(page, 'science-aging-brief', 'capacity-proxy', '72.00 kWh');
      await expectMetric(page, 'science-aging-brief', 'assumed-reference-capacity', '75.00 kWh');
      await expectMetric(page, 'science-aging-brief', 'holdout-rmse', '0.25 kWh');
      await expectMetric(page, 'science-weather-brief', 'density-correlation', '0.00');
      await expectMetric(page, 'science-weather-brief', 'wind-correlation', '—', 'missing');
      await expectMetric(page, 'science-weather-brief', 'rain-drives', '0');
      await expectMetric(page, 'science-weather-brief', 'dry-drives', '6');
      await expectMetric(page, 'science-tires-brief', 'front-left', '2.90 bar');
      await expectMetric(page, 'science-tires-brief', 'front-right', '2.92 bar');
      await expectMetric(page, 'science-tires-brief', 'rear-left', '2.88 bar');
      await expectMetric(page, 'science-tires-brief', 'rear-right', '2.91 bar');
      await expectMetric(page, 'science-tires-brief', 'imbalance', '0.04 bar');
      await expectMetric(page, 'science-tires-brief', 'underinflation', '7.00 %');
      await expectMetric(page, 'science-tires-brief', 'extra-rolling', '0.35 kWh');
      await expect(page.getByLabel('Rest-end pack voltage over the window', { exact: true }).locator('svg').first()).toBeVisible();
      await expect(page.getByLabel('Pack resistance over the window', { exact: true }).locator('svg').first()).toBeVisible();
      await expect(page.getByTestId('science-electrochem')).toContainText('1 charging pulse steps recorded separately from drive current steps');
      await expect(page.getByTestId('science-thermal')).toContainText('An unknown value is not a zero-minute cooldown');
      await expect(page.getByTestId('science-thermal').locator('[data-operational-brief]')).toHaveCount(0);
      await expect(page.getByTestId('science-notebook').locator('[data-operational-brief]')).toHaveCount(0);
      if (width === 1440) {
        const weatherTable = page.getByTestId('science-weather').getByRole('table');
        await expect(weatherTable.locator('tbody td[data-column-key="temp"]').first()).toHaveText('15.00°C');
        await expect(weatherTable.locator('tbody td[data-column-key="wind"]').first()).toHaveText('10.80 km/h');
        await expect(weatherTable.locator('tbody td[data-column-key="session"]').first()).toHaveText('170.00 Wh/km');
        await expect(weatherTable.locator('tbody td[data-column-key="res"]').first()).toHaveText('160.00 Wh/km');
        const thermalTable = page.getByTestId('science-thermal').getByRole('table');
        await expect(thermalTable.locator('tbody td[data-column-key="tau"]').first()).toHaveText('0.50 h');
        await expect(thermalTable.locator('tbody td[data-column-key="tau"]').last()).toHaveText('unknown');
        await expect(thermalTable.locator('tbody td[data-column-key="interval"]').first()).toHaveText('0.47 h…0.53 h');
      }

      const overviewDrawer = await openReview(page, 'science-evidence-brief');
      await expect(overviewDrawer).toContainText('2 of 3 rows with a result');
      await expect(overviewDrawer).toContainText('4 of 4 corners reported');
      await expect(overviewDrawer).toContainText('Counts are not a health grade');
      await expect(overviewDrawer).toContainText(thermalFixture.honesty);
      await expect(overviewDrawer).toContainText(weatherFixture.honesty);
      for (const domain of SCIENCE_DOMAINS) {
        await expect(overviewDrawer.locator(`a[href="#science-${domain}"]`)).toHaveAccessibleName('Inspect evidence');
      }
      await closeReview(page, 'science-evidence-brief');
      const samplingDrawer = await openReview(page, 'science-electrochem-brief');
      await expect(samplingDrawer).toContainText('2026.24.3');
      await expect(samplingDrawer).toContainText('Sample cap hit');
      await expect(samplingDrawer).toContainText('Rest-end pack voltage is not proven equilibrium OCV');
      await closeReview(page, 'science-electrochem-brief');
      const arrheniusDrawer = await openReview(page, 'science-arrhenius-brief');
      await expect(arrheniusDrawer).toContainText('CI: 6,651.20…9,976.80 J/mol');
      await expect(arrheniusDrawer).toContainText('Temperature difference, not an absolute temperature');
      await expect(arrheniusDrawer).toContainText(electrochemFixture.arrhenius.honesty);
      await closeReview(page, 'science-arrhenius-brief');
      const agingDrawer = await openReview(page, 'science-aging-brief');
      await expect(agingDrawer).toContainText('Assumed reference, not measured vehicle capacity');
      await expect(agingDrawer).toContainText('n=6.00');
      await expect(agingDrawer).toContainText(electrochemFixture.aging.honesty);
      await closeReview(page, 'science-aging-brief');
      const weatherDrawer = await openReview(page, 'science-weather-brief');
      await expect(weatherDrawer).toContainText('An unknown coefficient is not a zero effect');
      await expect(weatherDrawer).toContainText('rain/dry: 0.00/6.00');
      await closeReview(page, 'science-weather-brief');
      const tiresDrawer = await openReview(page, 'science-tires-brief');
      await expect(tiresDrawer).toContainText('Model sensitivity, not a confidence interval: 0.18 kWh…0.52 kWh');
      await expect(tiresDrawer).toContainText('500.00 km');
      await expect(tiresDrawer).toContainText('placard 3.10 bar');
      await closeReview(page, 'science-tires-brief');

      for (const domain of SCIENCE_DOMAINS) {
        const link = page.getByTestId('science-evidence-brief').locator(`a[href="#science-${domain}"]`);
        await link.click();
        await expect(page).toHaveURL(new RegExp(`#science-${domain}$`));
        await expect(page.getByTestId(`science-${domain}`)).toBeVisible();
      }
      await expect(page.getByTestId('science-weather').getByRole('link', { name: '#101', exact: true })).toHaveAttribute('href', '/drives/101');
      const entry = page.getByTestId('science-notebook').getByRole('button', { name: /electrochem · Synthetic rest-voltage observations map SOC/ });
      await entry.press('Enter');
      await expect(entry).toHaveAttribute('aria-expanded', 'true');
      const entryRegion = page.getByTestId('science-notebook').getByRole('region', { name: 'electrochem · Synthetic rest-voltage observations map SOC.', exact: true });
      await expect(entryRegion).toContainText('rest_ocv_binned');
      await expect(entryRegion).toContainText('Generated record: electrochem.ocv:7:synthetic');
      await expect(entryRegion).toContainText('cell_voltage_per_cell');
      await expect(entryRegion.getByRole('table', { name: 'Parameters', exact: true })).toContainText('400.500');
      await expectNoHorizontalOverflow(page);
      await expectNoRuntimeFailures(diagnostics);
      await assertMockApiComplete(page, controller);
    });

    test(`science distinguishes observed zero from unknown at ${width}px ${theme}`, async ({ page }) => {
      const { controller, diagnostics } = await bootScience(page, theme, width, 'zero');
      await expectMetric(page, 'science-electrochem-brief', 'rest-points', '0');
      await expectMetric(page, 'science-electrochem-brief', 'resistance-steps', '0');
      await expectMetric(page, 'science-aging-brief', 'throughput', '0.00 kWh');
      await expectMetric(page, 'science-aging-brief', 'rest-duration', '0.00 h');
      await expectMetric(page, 'science-aging-brief', 'proxy-slope', '0.00 Wh/day');
      await expectMetric(page, 'science-aging-brief', 'capacity-proxy', '0.00 kWh');
      await expectMetric(page, 'science-aging-brief', 'holdout-rmse', '0.00 kWh');
      await expectMetric(page, 'science-weather-brief', 'density-correlation', '0.00');
      await expectMetric(page, 'science-weather-brief', 'wind-correlation', '—', 'missing');
      await expectMetric(page, 'science-tires-brief', 'front-left', '0.00 bar');
      await expectMetric(page, 'science-tires-brief', 'front-right', '—', 'missing');
      await expectMetric(page, 'science-tires-brief', 'imbalance', '0.00 bar');
      await expectMetric(page, 'science-tires-brief', 'underinflation', '0.00 %');
      await expectMetric(page, 'science-tires-brief', 'extra-rolling', '0.00 kWh');
      await expectMetric(page, 'science-evidence-brief', 'science-tires', '2');
      await expect(metric(page, 'science-evidence-brief', 'science-tires')).toContainText('2 of 4 corners reported');
      const drawer = await openReview(page, 'science-weather-brief');
      await expect(drawer).toContainText('An unknown coefficient is not a zero effect');
      await closeReview(page, 'science-weather-brief');
      await expectNoHorizontalOverflow(page);
      await expectNoRuntimeFailures(diagnostics);
      await assertMockApiComplete(page, controller);
    });

    test(`science keeps nil arrays and nested ledgers missing rather than invented zero at ${width}px ${theme}`, async ({ page }) => {
      const { controller, diagnostics } = await bootScience(page, theme, width, 'nil-ledgers');
      for (const occurrence of ['science-electrochem', 'science-resistance-steps', 'science-thermal', 'science-weather', 'science-tires', 'science-notebook']) {
        await expectMetric(page, 'science-evidence-brief', occurrence, '0');
      }
      await expect(metric(page, 'science-evidence-brief', 'science-notebook')).toContainText('0 of 0 rows with a result');
      for (const occurrence of ['activation-energy', 'temperature-bins', 'temperature-span']) {
        await expectMetric(page, 'science-arrhenius-brief', occurrence, '—', 'missing');
      }
      for (const occurrence of ['throughput', 'rest-duration', 'proxy-slope', 'capacity-proxy', 'assumed-reference-capacity', 'holdout-rmse']) {
        await expectMetric(page, 'science-aging-brief', occurrence, '—', 'missing');
      }
      for (const occurrence of ['front-left', 'front-right', 'rear-left', 'rear-right', 'imbalance', 'underinflation', 'extra-rolling']) {
        await expectMetric(page, 'science-tires-brief', occurrence, '—', 'missing');
      }
      await expectMetric(page, 'science-weather-brief', 'density-correlation', '—', 'missing');
      await expectMetric(page, 'science-weather-brief', 'wind-correlation', '—', 'missing');
      await expect(page.getByTestId('science-notebook')).toContainText('No notebook rows in this window');
      await expect(page.getByTestId('science-weather')).toContainText('No drives joined archive weather in this window');
      const drawer = await openReview(page, 'science-arrhenius-brief');
      await expect(drawer).toContainText('Confidence interval unknown');
      await closeReview(page, 'science-arrhenius-brief');
      await expectNoHorizontalOverflow(page);
      await expectNoRuntimeFailures(diagnostics);
      await assertMockApiComplete(page, controller);
    });

    test(`science respects source eligibility without treating reported counts as scores at ${width}px ${theme}`, async ({ page }) => {
      const { controller, diagnostics } = await bootScience(page, theme, width, 'source-unknown');
      await expectOverview(page);
      await expectMetric(page, 'science-aging-brief', 'capacity-proxy', '—', 'missing');
      await expect(page.getByTestId('science-aging-brief')).toContainText('Limited evidence');
      await expect(page.getByTestId('science-evidence-brief')).toContainText('Limited evidence');
      for (const occurrence of ['front-left', 'front-right', 'rear-left', 'rear-right', 'imbalance', 'underinflation', 'extra-rolling']) {
        await expectMetric(page, 'science-tires-brief', occurrence, '—', 'missing');
      }
      await expectMetric(page, 'science-weather-brief', 'matched-drives', '6');
      await expect(metric(page, 'science-weather-brief', 'matched-drives')).toContainText('weather unknown');
      await expect(page.getByTestId('science-tires')).toContainText('No TPMS corners reported in this window');
      await expectNoHorizontalOverflow(page);
      await expectNoRuntimeFailures(diagnostics);
      await assertMockApiComplete(page, controller);
    });

    test(`science preserves SI operands across imperial display and real window controls at ${width}px ${theme}`, async ({ page }) => {
      const { controller, diagnostics, requests } = await bootScience(page, theme, width, 'populated', 'imperial');
      await expectMetric(page, 'science-tires-brief', 'front-left', '42.06 psi');
      await expectMetric(page, 'science-arrhenius-brief', 'temperature-span', '18.00°F');
      await expectMetric(page, 'science-arrhenius-brief', 'activation-energy', '8,314.00 J/mol');
      await expectMetric(page, 'science-aging-brief', 'throughput', '50.00 kWh');
      if (width === 1440) {
        const weatherTable = page.getByTestId('science-weather').getByRole('table');
        await expect(weatherTable.locator('tbody td[data-column-key="temp"]').first()).toHaveText('59.00°F');
        await expect(weatherTable.locator('tbody td[data-column-key="wind"]').first()).toHaveText('6.71 mph');
      }
      const drawer = await openReview(page, 'science-tires-brief');
      await expect(drawer).toContainText('310.69 mi');
      await expect(drawer).toContainText('placard 44.96 psi');
      await expect(drawer).toContainText('0.18 kWh…0.52 kWh');
      await closeReview(page, 'science-tires-brief');
      const windowControls = page.getByRole('group', { name: 'Window', exact: true });
      await expect(windowControls.getByRole('button', { name: 'Last 7d', exact: true })).toHaveAttribute('aria-pressed', 'true');
      await windowControls.getByRole('button', { name: 'Last 30d', exact: true }).click();
      await waitForHarnessReady(page, controller);
      await expect(windowControls.getByRole('button', { name: 'Last 30d', exact: true })).toHaveAttribute('aria-pressed', 'true');
      const params = new URL(page.url()).searchParams;
      expect(params.get('days')).toBe('30');
      const start = params.get('start');
      const end = params.get('end');
      if (!start || !end) throw new Error('Window control lost its URL bounds');
      expect(Date.parse(end) - Date.parse(start)).toBe(30 * 86400000);
      for (const domain of SCIENCE_DOMAINS) {
        expect(requests.some((request) => request.domain === domain && request.start === start && request.end === end),
        `${domain} did not receive both selected bounds`).toBe(true);
      }
      await expectMetric(page, 'science-tires-brief', 'front-left', '42.06 psi');
      await expect(page.getByTestId('science-tires-brief')).toContainText('Report loaded');
      await expect(page.getByTestId('science-tires-brief')).toContainText(
        `${formatDateTime(tiresFixture.start, { tz: 'UTC', locale: 'en-US' })} → ${formatDateTime(tiresFixture.end, { tz: 'UTC', locale: 'en-US' })}`,
      );
      await expectNoHorizontalOverflow(page);
      await expectNoRuntimeFailures(diagnostics);
      await assertMockApiComplete(page, controller);
    });
  }
}
