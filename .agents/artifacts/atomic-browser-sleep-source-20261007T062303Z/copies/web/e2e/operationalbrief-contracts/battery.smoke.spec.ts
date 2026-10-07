import { expect, test, type Locator, type Page } from '@playwright/test';
import { ROUTE_REGISTRY } from '../../src/lib/routeRegistry';
import type { SleepEfficiencyData } from '../../src/types/energy';
import {
  assertMockApiComplete, expectThemeApplied, fulfillApiFixture, installApiMocks,
  seedBrowserState, waitForHarnessReady, type MockApiController,
} from '../mockApi';
import {
  expectDialogsInsideViewport, expectNoHorizontalOverflow, expectNoRuntimeFailures,
  monitorPage,
} from '../qualityAssertions';
import {
  capacitySessions, careDrives, careSessions, cells, energyStats, equalCells, healthFixture, installBatteryEndpoint,
  installExistingBatterySources, installExistingEnergySources, ledgerDrive, missingHealth, noBrickCells, park, passport,
  passportVerification, powerLive, range, selectedEnergySession,
  sleepTransitionOnly, sleepWithDwell, sleepZeroAsleep, solarAdvice, split, vehicleFlow,
} from './battery.fixtures';

test.describe.configure({ timeout: 90_000 });

type Theme = 'light' | 'dark';
const sleepPath = '/sleep-efficiency?from=2026-08-04&to=2026-08-06';
const metric = (brief: Locator, key: string) => brief.locator(`[data-operational-metric="${key}"]`);
const band = (page: Page, id: string) => page.locator(`[data-operational-brief][data-testid="${id}"]`);

async function reading(brief: Locator, key: string, value: string | RegExp, state = 'value') {
  const item = metric(brief, key);
  await expect(item).toHaveAttribute('data-value-state', state);
  await expect(item.locator('[data-operational-value]')).toHaveText(value);
}

async function review(page: Page, brief: Locator, source: string | RegExp) {
  await expect(brief).toBeVisible();
  const publication = await brief.locator('[data-operational-metric]').allTextContents();
  const headings = await brief.getByRole('heading').allTextContents();
  const readings = await brief.locator('[data-operational-metric]').evaluateAll(nodes =>
    nodes.map(node => ({
      value: node.querySelector('[data-operational-value]')?.textContent?.trim() ?? '',
      detail: node.lastElementChild?.textContent?.trim() ?? '',
    })));
  const trigger = brief.getByRole('button', { name: 'Review details', exact: true });
  await trigger.focus();
  await expect(trigger).toBeFocused();
  await trigger.press('Enter');
  const drawer = page.getByRole('dialog');
  await expect(drawer).toBeVisible();
  await expect(drawer).toContainText(source);
  for (const row of readings) {
    if (row.value) await expect(drawer).toContainText(row.value);
    if (row.detail) await expect(drawer).toContainText(row.detail);
  }
  for (let index = 0; index < 4; index++) {
    await page.keyboard.press('Tab');
    expect(await drawer.evaluate(node => node.contains(document.activeElement)), 'drawer traps keyboard focus').toBe(true);
  }
  await expectDialogsInsideViewport(page);
  await expectNoHorizontalOverflow(page);
  await page.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);
  await expect(trigger).toBeFocused();
  expect(await brief.locator('[data-operational-metric]').allTextContents(), 'review preserves values, labels and details').toEqual(publication);
  expect(await brief.getByRole('heading').allTextContents(), 'review preserves the source heading').toEqual(headings);
}

async function setup(page: Page, theme: Theme, width: number, path: string) {
  expect(ROUTE_REGISTRY.some(route => route.path === path.split('?')[0]), 'generated application route').toBe(true);
  await page.setViewportSize({ width, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: theme });
  await seedBrowserState(page, theme, path);
  const mocks = await installApiMocks(page, 'populated', theme);
  if (!mocks) throw new Error('OperationalBrief battery source contracts require the strict mocked API harness');
  await installExistingBatterySources(page, mocks);
  return mocks;
}

async function ready(page: Page, mocks: MockApiController, path: string, theme: Theme) {
  await page.goto(path);
  await waitForHarnessReady(page, mocks);
  await expectThemeApplied(page, theme);
  await expect(page.getByText(/page failed to load/i)).toHaveCount(0);
}

async function finish(page: Page, mocks: MockApiController, diagnostics: ReturnType<typeof monitorPage>) {
  await expectNoHorizontalOverflow(page);
  await expectNoRuntimeFailures(diagnostics);
  await assertMockApiComplete(page, mocks);
}

for (const theme of ['light', 'dark'] as const) {
  for (const width of [320, 1440]) {
    test(`battery cells preserve three genuine electrical/temperature/count bands ${width} ${theme}`, async ({ page }) => {
      const mocks = await setup(page, theme, width, '/battery-cells');
      await installBatteryEndpoint(page, mocks, '/analytics/battery-cells', cells);
      const diagnostics = monitorPage(page);
      await ready(page, mocks, '/battery-cells', theme);
      const overview = band(page, 'battery-cells-overview');
      const temperature = band(page, 'battery-cells-temperature');
      const summary = band(page, 'battery-cells-summary');
      await reading(overview, 'overview-total', '4');
      await reading(overview, 'overview-average-voltage', /3\.8000\s*V/);
      await reading(overview, 'overview-imbalance', /20\.00\s*mV/);
      await reading(overview, 'overview-pack-voltage', /15\.20\s*V/);
      await reading(temperature, 'temperature-average', /28\.00\s*°C/);
      await reading(temperature, 'temperature-spread', /2\.00\s*°C/);
      await reading(summary, 'summary-normal-cells', '2/4');
      await review(page, overview, /cells are synthesized from brick extrema/i);
      await review(page, temperature, /Request time is not measurement time/i);
      await review(page, summary, /reported values alone do not establish health/i);
      const switchView = page.getByRole('button', { name: 'Switch to bar view', exact: true });
      await switchView.click();
      await expect(page.getByRole('button', { name: 'Switch to grid view', exact: true })).toHaveAttribute('aria-pressed', 'true');
      await reading(summary, 'summary-normal-cells', '2/4');
      await finish(page, mocks, diagnostics);
    });

    test(`battery cells measured zero is not no-brick unknown ${width} ${theme}`, async ({ page }) => {
      const mocks = await setup(page, theme, width, '/battery-cells');
      let response = equalCells;
      await installBatteryEndpoint(page, mocks, '/analytics/battery-cells', () => response);
      const diagnostics = monitorPage(page);
      await ready(page, mocks, '/battery-cells', theme);
      await reading(band(page, 'battery-cells-overview'), 'overview-imbalance', /0\.00\s*mV/);
      await reading(band(page, 'battery-cells-summary'), 'summary-normal-cells', '4/4');
      response = noBrickCells;
      // A new document is a fresh initial response, not a claimed refresh/retention test.
      await ready(page, mocks, '/battery-cells', theme);
      const overview = band(page, 'battery-cells-overview');
      await reading(overview, 'overview-total', '—', 'missing');
      await reading(overview, 'overview-average-voltage', '—', 'missing');
      await reading(overview, 'overview-imbalance', '—', 'missing');
      await reading(overview, 'overview-pack-voltage', /15\.20\s*V/);
      await reading(band(page, 'battery-cells-temperature'), 'temperature-average', /28\.00\s*°C/);
      await reading(band(page, 'battery-cells-temperature'), 'temperature-spread', /0\.00\s*°C/);
      await reading(band(page, 'battery-cells-summary'), 'summary-normal-cells', '—', 'missing');
      await finish(page, mocks, diagnostics);
    });

    test(`degradation preserves SI energy, fractional cycles, fit rate and specialist gauge ${width} ${theme}`, async ({ page }) => {
      const mocks = await setup(page, theme, width, '/battery-degradation');
      const health = { ...healthFixture(), total_cycles: 184.5 };
      await installBatteryEndpoint(page, mocks, '/analytics/battery-health', health);
      const diagnostics = monitorPage(page);
      await ready(page, mocks, '/battery-degradation', theme);
      const overview = band(page, 'battery-degradation-summary');
      const prediction = band(page, 'battery-degradation-prediction-stats');
      await reading(overview, 'percent:0', /94\.00\s*%/);
      await reading(overview, 'energy:1', /74\.2\s*kWh/);
      await reading(overview, 'battery-degradation-rate', '1.40%/yr');
      await reading(prediction, 'battery-degradation-fit-rate', '1.40%/yr');
      await reading(prediction, 'number:2', '184.50');
      await reading(prediction, 'percent:3', /34\.00\s*%/);
      const gauge = page.getByRole('meter', { name: /Current SOH/ });
      await expect(gauge).toHaveAttribute('aria-valuenow', '94');
      await expect(gauge).toHaveAttribute('aria-valuemax', '100');
      expect(await gauge.evaluate(node => Boolean(node.closest('[data-operational-brief]')))).toBe(false);
      await review(page, overview, /not direct pack-capacity measurements/i);
      await review(page, prediction, /partial cycles add up over time/i);
      await finish(page, mocks, diagnostics);
    });

    test(`health preserves specialist readings, capacity/range comparisons and real navigation ${width} ${theme}`, async ({ page }) => {
      const mocks = await setup(page, theme, width, '/battery');
      await installBatteryEndpoint(page, mocks, '/analytics/battery-health', healthFixture());
      const diagnostics = monitorPage(page);
      await ready(page, mocks, '/battery', theme);
      const summary = band(page, 'battery-health-summary');
      await reading(summary, 'soh', /94\.00\s*%/);
      await reading(summary, 'currentCap', /74\.20\s*kWh/);
      await reading(summary, 'originalCap', /79\.00\s*kWh/);
      await reading(summary, 'degradation', '1.40%/yr');
      await reading(summary, 'cycles', '184.00');
      await reading(summary, 'age', '36 months');
      await reading(summary, 'fullChargeComplete', '—', 'missing');
      await review(page, summary, /latest available BMS telemetry/i);
      const narrative = band(page, 'battery-operational-brief');
      await reading(narrative, 'health', '94.00%');
      await reading(narrative, 'degradation', '1.40%/yr');
      await reading(narrative, 'cycles', '184.00');
      await review(page, narrative, /latest available BMS telemetry/i);
      for (const [label, now, maximum] of [
        ['Health Score', '94', '100'], ['Degradation', '1.4', '10'], ['Cycles', '184', '1500'],
      ]) {
        const gauge = page.getByRole('meter', { name: label, exact: true });
        await expect(gauge).toHaveAttribute('aria-valuenow', now);
        await expect(gauge).toHaveAttribute('aria-valuemax', maximum);
        expect(await gauge.evaluate(node => Boolean(node.closest('[data-operational-brief]')))).toBe(false);
      }
      const comparisons = page.locator('[data-operational-brief]').filter({
        has: page.locator('[data-operational-metric="capacity-new"]'),
      });
      await reading(comparisons, 'capacity-new', /79\.00\s*kWh/);
      await reading(comparisons, 'capacity-now', /74\.20\s*kWh/);
      await reading(comparisons, 'range-new', /445\.00\s*km/);
      await reading(comparisons, 'range-now', /438\.00\s*km/);
      await review(page, comparisons, /capacity and range/i);
      for (const href of ['/battery-cells', '/battery-degradation', '/energy-flow', '/projected-range', '/vampire-drain', '/sleep-efficiency']) {
        await expect(page.getByRole('navigation', { name: 'Explore More' }).locator(`a[href="${href}"]`)).toBeVisible();
      }
      const link = page.getByRole('navigation', { name: 'Explore More' }).locator('a[href="/battery-degradation"]');
      await link.focus();
      await expect(link).toBeFocused();
      await link.press('Enter');
      await expect(page).toHaveURL(/\/battery-degradation$/);
      await waitForHarnessReady(page, mocks);
      await expect(band(page, 'battery-degradation-summary')).toBeVisible();
      await finish(page, mocks, diagnostics);
    });

    test(`projected range bridges source kilometres to raw metres and retains efficiency gauge ${width} ${theme}`, async ({ page }) => {
      const mocks = await setup(page, theme, width, '/projected-range');
      await installBatteryEndpoint(page, mocks, '/analytics/range-projection', range);
      const diagnostics = monitorPage(page);
      await ready(page, mocks, '/projected-range', theme);
      const summary = band(page, 'projected-range-summary');
      await reading(summary, 'your-estimate', /438\.00\s*km/);
      await reading(summary, 'tesla-estimate', /410\.00\s*km/);
      await reading(summary, 'usable-capacity', /74\.20\s*kWh/);
      await reading(summary, 'health', /94\.00\s*%/);
      const gauge = page.getByRole('meter', { name: /Efficiency/ });
      await expect(gauge).toHaveAttribute('aria-valuenow', '94');
      await expect(gauge).toHaveAttribute('aria-valuemax', '100');
      await review(page, summary, /not scoped to a selected date window/i);
      await finish(page, mocks, diagnostics);
    });

    test(`health no-model outline preserves unknown bands instead of zero health or capacity ${width} ${theme}`, async ({ page }) => {
      const mocks = await setup(page, theme, width, '/battery');
      await installBatteryEndpoint(page, mocks, '/analytics/battery-health', missingHealth);
      const diagnostics = monitorPage(page);
      await ready(page, mocks, '/battery', theme);
      await expect(page.getByTestId('battery-health-unavailable-outline')).toBeVisible();
      const narrative = band(page, 'battery-operational-brief');
      for (const key of ['health', 'degradation', 'range-confidence', 'charging-stress', 'thermal-impact', 'cycles']) {
        await reading(narrative, key, '—', 'missing');
      }
      const summary = band(page, 'battery-health-summary');
      for (const key of ['soh', 'currentCap', 'originalCap', 'degradation', 'cycles', 'age', 'fullChargeComplete']) {
        await reading(summary, key, '—', 'missing');
      }
      const comparisons = page.locator('[data-operational-brief]').filter({
        has: page.locator('[data-operational-metric="capacity-new"]'),
      });
      for (const key of ['capacity-new', 'capacity-now', 'range-new', 'range-now']) {
        await reading(comparisons, key, '—', 'missing');
      }
      await expect(page.getByRole('meter', { name: 'Health Score', exact: true })).toHaveCount(0);
      await review(page, narrative, /capacity measurements are not available yet/i);
      await review(page, comparisons, /battery health cannot be assessed/i);
      await expect(page.getByRole('navigation', { name: 'Explore More' }).locator('a[href="/battery-degradation"]')).toBeVisible();
      await finish(page, mocks, diagnostics);
    });

    test(`energy flow preserves returned period denominator and SI energy/distance/efficiency ${width} ${theme}`, async ({ page }) => {
      const path = '/energy-flow?from=2026-08-04&to=2026-08-06';
      const mocks = await setup(page, theme, width, path);
      await installBatteryEndpoint(page, mocks, '/vehicles/7/energy', energyStats, { days: '3' });
      await installBatteryEndpoint(page, mocks, '/vehicles/7/energy/flow', vehicleFlow, {});
      const diagnostics = monitorPage(page);
      await ready(page, mocks, path, theme);
      const overview = page.locator('[data-operational-brief]').filter({
        has: page.locator('[data-operational-metric="total-used"]'),
      });
      const drivers = page.locator('[data-operational-brief]').filter({
        has: page.locator('[data-operational-metric="average-per-day"]'),
      });
      await reading(overview, 'total-used', /12\.00\s*kWh/);
      await reading(overview, 'total-charged', /15\.00\s*kWh/);
      await reading(overview, 'distance:2', /100\.00\s*km/);
      await reading(overview, 'average-efficiency', /120\.00\s*Wh\/km/);
      await reading(overview, 'period-days', '30 days');
      // The returned 30-day denominator is not the two visible daily rows or
      // the requested 3-day window. The source limitation remains explicit.
      await reading(drivers, 'average-per-day', /0\.40\s*kWh/);
      await expect(overview).toContainText('Trailing 3 days');
      await review(page, overview, /custom calendar bounds are not applied by this source/i);
      await review(page, drivers, /Estimated avoided CO₂, not a vehicle emissions measurement/i);
      await finish(page, mocks, diagnostics);
    });

    test(`energy products aggregate only discovered sites and retain entity/configuration specialist gauge ${width} ${theme}`, async ({ page }) => {
      const mocks = await setup(page, theme, width, '/energy-products');
      await installExistingEnergySources(page, mocks);
      const diagnostics = monitorPage(page);
      await ready(page, mocks, '/energy-products', theme);
      const summary = band(page, 'energy-products-summary');
      for (const key of ['sites', 'solar', 'battery', 'backup', 'storm']) {
        await reading(summary, key, '1');
      }
      await reading(summary, 'capacity', /13\.50\s*kWh/);
      await expect(page.getByText('Review home', { exact: true })).toBeVisible();
      const reserve = page.getByRole('meter', { name: 'Backup Reserve', exact: true });
      await expect(reserve).toHaveAttribute('aria-valuenow', '20');
      await expect(reserve).toHaveAttribute('aria-valuemax', '100');
      expect(await reserve.evaluate(node => Boolean(node.closest('[data-operational-brief]')))).toBe(false);
      await review(page, summary, /site timestamps are shown on each card/i);
      await finish(page, mocks, diagnostics);
    });

    test(`energy preserves selected daily operands, charging cost coverage and lifetime unknown ${width} ${theme}`, async ({ page }) => {
      const path = '/energy?from=2026-08-25&to=2026-08-26';
      const mocks = await setup(page, theme, width, path);
      await installBatteryEndpoint(page, mocks, '/vehicles/7/energy', energyStats, { start: '2026-08-25' });
      await installBatteryEndpoint(page, mocks, '/charging', [selectedEnergySession()], {
        vehicle_id: '7', limit: '100', offset: '0', start: '2026-08-25', end: '2026-08-26',
      });
      const diagnostics = monitorPage(page);
      await ready(page, mocks, path, theme);
      const summary = band(page, 'energy-summary');
      await reading(summary, 'totalDistance', '100 km');
      await reading(summary, 'sessions', '1');
      const narrative = band(page, 'energy-operational-brief');
      await reading(narrative, 'consumption', /12\.00\s*kWh/);
      await reading(narrative, 'efficiency', /120\s*Wh\/km/);
      await reading(narrative, 'charging-loss', 'Not measured', 'missing');
      await expect(metric(narrative, 'cost')).toContainText('1 of 1 returned sessions include cost');
      await review(page, narrative, /Independent wall-input and battery-retained energy are absent/i);
      const drivers = page.locator('[data-operational-brief]').filter({
        has: page.locator('[data-operational-metric="highest-day"]'),
      });
      await reading(drivers, 'highest-day', /166\.67\s*Wh\/km/);
      await reading(drivers, 'lowest-day', /100\.00\s*Wh\/km/);
      // Difference 0.06666... Wh/m / weighted 12,000 Wh / 100,000 m.
      await reading(drivers, 'observed-spread', /55\.56\s*%/);
      await reading(drivers, 'highest-day-distance', /30\.00\s*km/);
      const lifetime = page.locator('[data-operational-brief]').filter({
        has: page.locator('[data-operational-metric="lifetime-energy"]'),
      });
      await reading(lifetime, 'lifetime-energy', '—', 'missing');
      await reading(lifetime, 'period-energy', /42\.10\s*kWh/);
      await expect(page.locator('main a[href="/charging/201"]')).toBeVisible();
      for (const href of ['/temperature-impact', '/speed-profile', '/route-efficiency']) {
        await expect(page.locator(`main a[href="${href}"]`)).toBeVisible();
      }
      await review(page, drivers, 'Context only, not causal attribution');
      await review(page, lifetime, /lifetime BMS counter is reported in kWh/i);
      await review(page, summary, /costs from returned charging sessions/i);
      await finish(page, mocks, diagnostics);
    });

    test(`energy ledger preserves Wh conservation and true zero residual ${width} ${theme}`, async ({ page }) => {
      const mocks = await setup(page, theme, width, '/energy-ledger');
      await installBatteryEndpoint(page, mocks, '/charging-sessions', [capacitySessions[0]], { vehicle_id: '7' });
      await installBatteryEndpoint(page, mocks, '/drives', [ledgerDrive], { vehicle_id: '7' });
      const diagnostics = monitorPage(page);
      await ready(page, mocks, '/energy-ledger', theme);
      const summary = page.locator('[data-operational-brief]').filter({
        has: page.locator('[data-operational-metric="ledger-closure"]'),
      });
      // 45,000 Wh charged = 22,500 Wh driven + 22,500 Wh still stored.
      await reading(summary, 'ledger-closure', '100%');
      await reading(summary, 'ledger-driving', '50%');
      await reading(summary, 'ledger-residual', /0\.00\s*kWh/);
      await reading(summary, 'ledger-vampire', '0 Wh/day');
      await expect(metric(summary, 'ledger-residual')).toContainText(/derived pack 75\.00\s*kWh/);
      await review(page, summary, /exact complete-history bounds are not supplied/i);
      await finish(page, mocks, diagnostics);
    });

    test(`power flow keeps signed raw watts, specialist auto-scaling and separate SoC gauge ${width} ${theme}`, async ({ page }) => {
      const path = '/power-flow?from=2026-08-04&to=2026-08-06';
      const mocks = await setup(page, theme, width, path);
      const live = powerLive();
      await installBatteryEndpoint(page, mocks, '/tesla/energy-sites/1/live-status', live, {});
      await installBatteryEndpoint(page, mocks, '/tesla/energy-sites/1/live-status/history', [live], {
        since: '2026-08-04', until: '2026-08-06', limit: '1000',
      });
      await installBatteryEndpoint(page, mocks, '/tesla/energy-sites/1/charge-advice', solarAdvice, {});
      const diagnostics = monitorPage(page);
      await ready(page, mocks, path, theme);
      const summary = page.locator('[data-operational-brief]').filter({
        has: page.locator('[data-operational-metric="power-flow-solar"]'),
      });
      await reading(summary, 'power-flow-solar', /4\.20\s*kW/);
      await reading(summary, 'power-flow-battery', /-1\.00\s*kW/);
      await reading(summary, 'power-flow-load', /2\.50\s*kW/);
      await reading(summary, 'power-flow-grid', /-700\.00\s*W/);
      await expect(metric(summary, 'power-flow-battery')).toContainText('Charging');
      await expect(metric(summary, 'power-flow-grid')).toContainText('Exporting');
      const gauge = page.getByRole('meter', { name: 'State of Charge', exact: true });
      await expect(gauge).toHaveAttribute('aria-valuenow', '78');
      await expect(gauge).toHaveAttribute('aria-valuemax', '100');
      expect(await gauge.evaluate(node => Boolean(node.closest('[data-operational-brief]')))).toBe(false);
      await review(page, summary, 'Live energy status');
      await finish(page, mocks, diagnostics);
    });

    for (const [name, fixture, countShare, durationShare, timeToSleep] of [
      ['dwell-versus-count denominators', sleepWithDwell, '40.00%', '75.00%', '12.00 min'],
      ['transition-only unknown duration', sleepTransitionOnly, '80.00%', null, null],
      ['real zero asleep destinations', sleepZeroAsleep, '0.00%', null, null],
    ] as const) {
      test(`sleep ${name} ${width} ${theme}`, async ({ page }) => {
        const mocks = await setup(page, theme, width, sleepPath);
        await installBatteryEndpoint(page, mocks, '/analytics/sleep', fixture, {
          vehicle_id: '7', days: '3', start: '2026-08-04', end: '2026-08-06',
        });
        const diagnostics = monitorPage(page);
        await ready(page, mocks, sleepPath, theme);
        const summary = band(page, 'sleep-efficiency-evidence');
        await reading(summary, 'sleep-destinations', '10');
        await reading(summary, 'sleep-asleep-count-share', countShare);
        await reading(summary, 'sleep-duration-efficiency', durationShare ?? '—', durationShare == null ? 'missing' : 'value');
        await reading(summary, 'sleep-average-time-to-sleep', timeToSleep ?? '—', timeToSleep == null ? 'missing' : 'value');
        await expect(metric(summary, 'sleep-asleep-count-share')).toContainText('Count-based; not a time share');
        await expect(metric(summary, 'sleep-evidence-breadth')).toContainText('Source support score; not confidence');
        await review(page, summary, /unavailable evidence is never rendered as a measured zero/i);
        await finish(page, mocks, diagnostics);
      });
    }

    test(`care uses valid SoC rows and classified Wh denominator, not all returned rows ${width} ${theme}`, async ({ page }) => {
      const mocks = await setup(page, theme, width, '/battery-care');
      await installBatteryEndpoint(page, mocks, '/charging', careSessions, { vehicle_id: '7', limit: '1000' });
      await installBatteryEndpoint(page, mocks, '/drives', careDrives, { vehicle_id: '7', limit: '1000' });
      const diagnostics = monitorPage(page);
      await ready(page, mocks, '/battery-care', theme);
      const summary = band(page, 'battery-care-summary');
      await reading(summary, 'battery-care-score', '—', 'missing');
      await reading(summary, 'battery-care-full-charges', /50\.00\s*%/);
      await reading(summary, 'battery-care-deep-arrivals', /50\.00\s*%/);
      // 10,000 DC / (30,000 AC + 10,000 DC), not /60,000 including unknown.
      await reading(summary, 'battery-care-dc-energy', /25\.00\s*%/);
      await expect(metric(summary, 'battery-care-full-charges')).toContainText('of 2 sessions');
      await expect(metric(summary, 'battery-care-deep-arrivals')).toContainText('of 2 drive arrivals below 10%');
      await review(page, summary, /unclassified energy stays visible here and can withhold the score/i);
      await finish(page, mocks, diagnostics);
    });

    test(`pack capacity preserves qualified raw Wh and filter assumptions ${width} ${theme}`, async ({ page }) => {
      const mocks = await setup(page, theme, width, '/pack-capacity');
      await installBatteryEndpoint(page, mocks, '/charging', capacitySessions, { vehicle_id: '7', limit: '1000' });
      const diagnostics = monitorPage(page);
      await ready(page, mocks, '/pack-capacity', theme);
      const summary = band(page, 'pack-capacity-summary');
      const accounting = band(page, 'pack-capacity-accounting-summary');
      await reading(summary, 'pack-capacity:current', /75\.00\s*kWh/);
      await reading(summary, 'pack-capacity:raw-median', /75\.00\s*kWh/);
      await reading(accounting, 'pack-capacity:returned', '3');
      await reading(accounting, 'pack-capacity:accepted', '3');
      await reading(accounting, 'pack-capacity:excluded', '0');
      await review(page, summary, /not a lifetime record or a battery-health measurement/i);
      await page.getByLabel('Minimum SoC window', { exact: true }).selectOption('40');
      await reading(summary, 'pack-capacity:current', /75\.00\s*kWh/);
      await reading(accounting, 'pack-capacity:accepted', '3');
      await finish(page, mocks, diagnostics);
    });

    test(`cycle stress zero returned counts do not manufacture median depth ${width} ${theme}`, async ({ page }) => {
      const mocks = await setup(page, theme, width, '/cycle-stress');
      await installBatteryEndpoint(page, mocks, '/charging', [], { vehicle_id: '7', limit: '1000' });
      await installBatteryEndpoint(page, mocks, '/drives', [], { vehicle_id: '7', limit: '1000' });
      const diagnostics = monitorPage(page);
      await ready(page, mocks, '/cycle-stress', theme);
      const summary = band(page, 'cycle-stress-summary');
      const accounting = page.getByTestId('cycle-stress-accounting').locator('[data-operational-brief]');
      await reading(summary, 'cycle-stress:intervals', /^0(?:\.0+)?$/);
      await reading(summary, 'cycle-stress:median-depth', '—', 'missing');
      await reading(summary, 'cycle-stress:deep-share', '—', 'missing');
      for (const key of ['rows-returned', 'accepted-intervals', 'excluded-rows', 'source-types']) {
        await reading(accounting, key, '0');
      }
      await review(page, summary, /not a selected-date-window or full-history total/i);
      await page.getByLabel('Deep-cycle lens', { exact: true }).selectOption('40');
      await page.getByLabel('Depth exponent', { exact: true }).selectOption('2');
      await reading(summary, 'cycle-stress:median-depth', '—', 'missing');
      await finish(page, mocks, diagnostics);
    });

    test(`charge advisor retains separate current snapshot and empty-history count evidence ${width} ${theme}`, async ({ page }) => {
      const mocks = await setup(page, theme, width, '/charge-advisor');
      await installExistingEnergySources(page, mocks);
      await installBatteryEndpoint(page, mocks, '/charging', [], { vehicle_id: '7', limit: '1000' });
      await installBatteryEndpoint(page, mocks, '/drives', [], { vehicle_id: '7', limit: '1000' });
      const diagnostics = monitorPage(page);
      await ready(page, mocks, '/charge-advisor', theme);
      const summary = page.getByTestId('charge-advisor-kpis').locator('[data-operational-brief]');
      await reading(summary, 'advisor-drive-evidence', '0');
      await reading(summary, 'advisor-charging-evidence', '0');
      await reading(summary, 'advisor-daily-drop', '—', 'missing');
      const accounting = page.getByTestId('charge-advisor-accounting');
      for (const [source, title] of [
        ['drive', 'Drive-row evidence summary'], ['charging', 'Charging-row evidence summary'],
      ] as const) {
        const rows = accounting.locator('[data-operational-brief]').filter({
          has: page.getByRole('heading', { name: title, exact: true }),
        });
        for (let index = 0; index < 3; index++) {
          await reading(rows, `advisor-${source}-accounting-${index}`, '0');
        }
        await review(page, rows, /Counts are not lifetime totals/i);
      }
      await review(page, summary, /current SoC is a separate observed snapshot/i);
      await finish(page, mocks, diagnostics);
    });

    test(`passport preserves reported capacity reference, fractional EFC and session-share denominator ${width} ${theme}`, async ({ page }) => {
      const mocks = await setup(page, theme, width, '/battery-passport');
      await installBatteryEndpoint(page, mocks, '/vehicles/7/battery-passport', passport, {});
      await installBatteryEndpoint(page, mocks, '/vehicles/7/battery-passport/verify', passportVerification, {
        hash: passport.provenance_hash,
      });
      const diagnostics = monitorPage(page);
      await ready(page, mocks, '/battery-passport', theme);
      const summary = page.getByTestId('battery-passport-kpis').locator('[data-operational-brief]');
      await reading(summary, 'passport-soh', '91.20%');
      await reading(summary, 'passport-capacity', '68.40 / 75.00 kWh');
      await reading(summary, 'passport-efc', '321.40');
      await reading(summary, 'passport-fast-share', '12.50%');
      await reading(summary, 'passport-end-soc', '81.20%');
      await reading(summary, 'passport-grade', 'B');
      await expect(metric(summary, 'passport-fast-share')).toContainText('share of counted charging sessions');
      await review(page, summary, /no calibration, causality, or remaining-life claim/i);
      await finish(page, mocks, diagnostics);
    });

    test(`vampire preserves hours-to-seconds bridge, sessions, split and culprit bands ${width} ${theme}`, async ({ page }) => {
      const mocks = await setup(page, theme, width, '/vampire-drain');
      await installBatteryEndpoint(page, mocks, '/physics/vampire', split);
      await installBatteryEndpoint(page, mocks, '/physics/park-truth', park);
      const diagnostics = monitorPage(page);
      await ready(page, mocks, '/vampire-drain', theme);
      const summary = band(page, 'vampire-drain-summary');
      await reading(summary, 'vampire-average', /1\.50\s*%/);
      await reading(summary, 'vampire-observed', /12(?:\.00)?\s*h/);
      await expect(metric(summary, 'vampire-observed')).toContainText('1 sessions');
      await expect(summary).toContainText('30-day sample window');
      const splitBand = page.getByTestId('vampire-split').locator('[data-operational-brief]');
      await reading(splitBand, 'vampire-plugged', /0\.40\s*%/);
      await reading(splitBand, 'vampire-unplugged', /1\.80\s*%/);
      const culprit = page.getByTestId('vampire-culprits').locator('[data-operational-brief]');
      await reading(culprit, 'vampire-culprit-sentry', 'On');
      await reading(culprit, 'vampire-culprit-unplugged_leak', /1\.80\s*%/);
      await review(page, summary, /up to 200 loaded parked windows/i);
      await review(page, splitBand, 'Split uses confirmed Park windows.');
      await review(page, culprit, /independent source coverage/i);
      await finish(page, mocks, diagnostics);
    });
  }
}

test('sleep source refresh holds published values until success without inventing duration evidence', async ({ page }) => {
  const mocks = await setup(page, 'dark', 320, sleepPath);
  let response: SleepEfficiencyData = sleepTransitionOnly;
  let release!: () => void;
  let hold = false;
  let reads = 0;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route(url => url.pathname === '/api/v1/analytics/sleep', async route => {
    expect(route.request().method()).toBe('GET');
    const params = new URL(route.request().url()).searchParams;
    expect(Object.fromEntries(params)).toEqual({
      vehicle_id: '7', days: '3', start: '2026-08-04', end: '2026-08-06',
    });
    reads++;
    if (hold) await held;
    await fulfillApiFixture(route, mocks, { json: response });
  });
  const diagnostics = monitorPage(page);
  try {
    await ready(page, mocks, sleepPath, 'dark');
    const summary = band(page, 'sleep-efficiency-evidence');
    await reading(summary, 'sleep-asleep-count-share', '80.00%');
    const previousReads = reads;
    hold = true;
    await page.getByRole('button', { name: /^Refresh data/ }).click();
    await expect.poll(() => reads).toBeGreaterThan(previousReads);
    await reading(summary, 'sleep-asleep-count-share', '80.00%');
    await reading(summary, 'sleep-duration-efficiency', '—', 'missing');
    await review(page, summary, /unavailable evidence is never rendered as a measured zero/i);
    response = sleepWithDwell;
    hold = false;
    release();
    await reading(summary, 'sleep-asleep-count-share', '40.00%');
    await reading(summary, 'sleep-duration-efficiency', '75.00%');
    await waitForHarnessReady(page, mocks);
    await finish(page, mocks, diagnostics);
  } finally {
    release();
  }
});
