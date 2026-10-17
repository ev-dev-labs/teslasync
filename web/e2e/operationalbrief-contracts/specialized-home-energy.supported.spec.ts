import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  assertMockApiComplete, expectThemeApplied, fulfillApiFixture, installApiMocks,
  mockAppSettings, seedBrowserState, waitForHarnessReady, type MockApiController,
} from '../mockApi';
import {
  expectDialogsInsideViewport, expectNoHorizontalOverflow, expectNoRuntimeFailures, monitorPage,
} from '../qualityAssertions';
import type { CanonicalPlanExport } from '../../src/features/home-energy/lib/planExport';
import type { OrchestrationScenario } from '../../src/features/home-energy/hooks/useOrchestrationScenario';
import { formatEnergy, formatPower, type UnitPref } from '../../src/lib/unitConversion';
import { fmtNumber } from '../../src/lib/numberFormat';
import {
  HOME_ANCHOR, HOME_REANCHOR, HOME_SCENARIO_KEY, HOME_SITE_ID, expectedHomePlan,
  homeFleetStates, homeHistory, homeLiveStatus, homeScenario, homeSiteInfo, homeSites, homeVehicles,
} from './specialized-home-energy.supported.fixtures';

type Theme = 'dark' | 'light';
const historyPath = `/tesla/energy-sites/${HOME_SITE_ID}/energy-history`;
const costFirst = {
  readiness: 2, cost: 4, selfConsumption: 1.5, peakShaving: 1, reserve: 1, stability: 0.5,
};
const homeDisplay: UnitPref = {
  distance: 'km', speed: 'km/h', temperature: '°C', pressure: 'bar',
  energy: 'kWh', duration: 'h', power: 'kW',
  locale: mockAppSettings.locale, precision: mockAppSettings.decimal_precision,
};

async function setup(page: Page, theme: Theme, width: number) {
  await page.setViewportSize({ width, height: 900 });
  await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
  await page.clock.setFixedTime(new Date(HOME_ANCHOR));
  await seedBrowserState(page, theme, '/energy-orchestrator');
  await page.addInitScript(({ key, scenario }) => {
    localStorage.setItem(key, JSON.stringify(scenario));
  }, { key: HOME_SCENARIO_KEY, scenario: homeScenario() });
  const diagnostics = monitorPage(page);
  const mocks = await installApiMocks(page, 'populated', theme);
  if (!mocks) throw new Error('Home source contracts require strict mocked mode');
  const reads = new Map<string, number>();
  async function get(path: string, response: () => Promise<{ status: number; json: unknown }> | { status: number; json: unknown },
    query: Record<string, string> = {}) {
    await page.route(url => url.pathname === `/api/v1${path}`, async route => {
      expect(route.request().method(), path).toBe('GET');
      const url = new URL(route.request().url());
      expect(Object.fromEntries(url.searchParams), `${path} exact query`).toEqual(query);
      reads.set(path, (reads.get(path) ?? 0) + 1);
      const fixture = await response();
      await fulfillApiFixture(route, mocks, {
        status: fixture.status, contentType: 'application/json', body: JSON.stringify(fixture.json),
      });
    });
  }
  await get('/settings', () => ({ status: 200, json: {
    ...mockAppSettings, mode: theme, tz_display_default: 'user', timezone_user: 'UTC',
  } }));
  await get('/vehicles', () => ({ status: 200, json: homeVehicles }));
  await get('/vehicles/states', () => ({ status: 200, json: homeFleetStates }), { vehicle_ids: '7', limit: '500' });
  await get('/tesla/energy-sites', () => ({ status: 200, json: homeSites }));
  await get(`/tesla/energy-sites/${HOME_SITE_ID}/site-info`, () => ({ status: 200, json: homeSiteInfo }));
  await get(`/tesla/energy-sites/${HOME_SITE_ID}/live-status`, () => ({ status: 200, json: homeLiveStatus }));
  return { mocks, diagnostics, reads, get };
}

async function metric(brief: Locator, key: string, value: string | RegExp) {
  const item = brief.locator(`[data-operational-metric="${key}"]`);
  await expect(item).toHaveAttribute('data-value-state', 'value');
  await expect(item.locator('[data-operational-value]')).toHaveText(value);
}

async function review(page: Page, brief: Locator, title: string, evidence: readonly string[]) {
  const before = await brief.locator('[data-operational-metric]').allTextContents();
  const trigger = brief.getByRole('button', { name: 'Review details', exact: true });
  await trigger.focus();
  await trigger.press('Enter');
  const drawer = page.getByRole('dialog', { name: `${title} details`, exact: true });
  await expect(drawer).toBeVisible();
  await expect(drawer).toHaveAttribute('aria-modal', 'true');
  for (const text of evidence) await expect(drawer).toContainText(text);
  await expectDialogsInsideViewport(page);
  await page.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);
  await expect(trigger).toBeFocused();
  expect(await brief.locator('[data-operational-metric]').allTextContents()).toEqual(before);
}

async function canonicalPlan(page: Page): Promise<CanonicalPlanExport> {
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download canonical JSON plan', exact: true }).click();
  const stream = await (await download).createReadStream();
  if (!stream) throw new Error('Canonical plan download has no readable body');
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as CanonicalPlanExport;
}

async function assertPlan(page: Page, scenario: OrchestrationScenario, start = HOME_ANCHOR, history = homeHistory) {
  const expected = expectedHomePlan(scenario, start, history);
  const actual = await canonicalPlan(page);
  expect(actual.schemaVersion).toBe(1);
  expect(actual.input).toEqual(expected.input);
  expect(actual.result).toEqual(expected.result);
  expect(actual.disclaimer).toContain('locally-computed recommendation only');
  const brief = page.getByTestId('home-energy-outcomes');
  await expect(brief).toContainText(start);
  await expect(brief).toContainText(new Date(Date.parse(start) + scenario.horizonHours * 3_600_000).toISOString());
  await metric(brief, 'overall', String(Math.round(expected.result.scores.overall)));
  // The preference supplies a glyph, not an observed ISO currency denomination.
  await metric(brief, 'projected-cost', `${mockAppSettings.currency_symbol}${fmtNumber(
    expected.result.totals.totalCost, mockAppSettings.decimal_precision, mockAppSettings.locale,
  )}`);
  await metric(brief, 'peak-grid-import', formatPower(expected.result.totals.peakGridImportW, homeDisplay));
  await metric(brief, 'unmet-energy', formatEnergy(expected.result.vehicles.reduce((sum, v) => sum + v.unmetWh, 0), homeDisplay));
  await metric(brief, 'vehicles-ready', `${expected.result.vehicles.filter(v => v.readinessAchieved).length}/1`);
  return expected;
}

async function assertSections(page: Page) {
  for (const title of [
    'Scenario & assumptions', 'Vehicle assumptions', 'Energy flow schedule',
    'Per-vehicle readiness', 'Powerwall trajectory', 'Tariff & constraint heatmap',
    'Constraint violations', 'Export plan',
  ]) await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
  await expect(page.getByTestId('home-energy-outcomes')).toBeVisible();
  await expect(page.getByTestId('home-energy-forecast-quality')).toBeVisible();
  await expect(page.getByText('Source inputs when available: vehicle SoC and solar/load history from Supported solar home.', { exact: true })).toBeVisible();
  await expect(page.getByText('This plan is a recommendation only. TeslaSync never issues a command to a vehicle, Powerwall, or utility as a result of it.', { exact: true })).toBeVisible();
}

async function assertQuality(page: Page, expected: ReturnType<typeof expectedHomePlan>) {
  const quality = page.getByTestId('home-energy-forecast-quality');
  for (const [key, forecast] of [['solar-confidence', expected.solar], ['load-confidence', expected.load]] as const) {
    await metric(quality, key, `${Math.round(forecast.confidence * 100)}%`);
    await expect(quality.locator(`[data-operational-metric="${key}"]`))
      .toContainText(`${forecast.sourceSampleCount} history sample(s)`);
  }
  await review(page, quality, 'Assumptions & forecast quality', expected.solar.latestSampleIso ? [
    'High', expected.solar.latestSampleIso,
    'not confidence in measured vehicle or battery state.',
  ] : ['No history', 'No source history sample timestamp is available.']);
}

async function assertSiblings(mocks: MockApiController) {
  for (const path of [
    '/vehicles', '/vehicles/states', '/tesla/energy-sites',
    `/tesla/energy-sites/${HOME_SITE_ID}/site-info`, `/tesla/energy-sites/${HOME_SITE_ID}/live-status`,
  ]) {
    await expect.poll(() => mocks.requests.some(request =>
      request.path === `/api/v1${path}` && request.disposition === 'fulfilled')).toBe(true);
  }
  expect(mocks.requests.filter(request => request.path.startsWith('/api/v1/tesla/energy-sites/41/'))).toEqual([]);
}

for (const theme of ['dark', 'light'] as const) {
  for (const width of [320, 1440]) {
    test(`supported home positive history, modeled outcomes and actual scenario actions ${theme} ${width}`, async ({ page }) => {
      const { mocks, diagnostics, reads, get } = await setup(page, theme, width);
      await get(historyPath, () => ({ status: 200, json: homeHistory }), { period: 'day' });
      await page.goto('/energy-orchestrator');
      await waitForHarnessReady(page, mocks);
      await expectThemeApplied(page, theme);
      await assertSiblings(mocks);
      await assertSections(page);
      let scenario = homeScenario();
      const positive = await assertPlan(page, scenario);
      expect(positive.solar.seriesW.some(w => w > 0)).toBe(true);
      expect(positive.load.seriesW.every(w => w > 0)).toBe(true);
      expect(positive.result.totals.solarWh).toBeGreaterThan(0);
      expect(positive.result.totals.loadWh).toBeGreaterThan(0);
      expect(positive.solar.sourceSampleCount).toBe(homeHistory.length);
      expect(positive.load.sourceSampleCount).toBe(homeHistory.length);
      expect(positive.solar.latestSampleIso).toBe(homeHistory[homeHistory.length - 1].timestamp);
      expect(positive.load.latestSampleIso).toBe(homeHistory[homeHistory.length - 1].timestamp);
      expect(positive.input.vehicles[0].currentSocPct).toBe(30);
      expect(positive.input.powerwall?.currentSocPct).toBe(60);
      await assertQuality(page, positive);
      const outcomes = page.getByTestId('home-energy-outcomes');
      await review(page, outcomes, 'Planning outcomes', [
        'Modeled recommendation score, not source confidence',
        'Projected net cost using editable tariff assumptions',
        'raw input in watts', 'raw input in watt-hours', 'end exclusive',
      ]);
      await page.getByRole('slider', { name: 'Horizon', exact: true }).press('Home');
      scenario = { ...scenario, horizonHours: 6 };
      await expect(page.getByRole('slider', { name: 'Horizon', exact: true })).toHaveValue('6');
      await assertPlan(page, scenario);
      await page.getByRole('slider', { name: 'Max grid import', exact: true }).press('Home');
      scenario = { ...scenario, grid: { ...scenario.grid, maxImportW: 1_000 } };
      await expect(page.getByRole('slider', { name: 'Max grid import', exact: true })).toHaveValue('1000');
      await assertPlan(page, scenario);
      await page.getByRole('combobox', { name: 'Optimization priority', exact: true }).selectOption('costFirst');
      scenario = { ...scenario, weights: costFirst };
      const changed = await assertPlan(page, scenario);
      expect(changed.result.vehicles[0].unmetWh).toBeGreaterThan(0);
      await page.getByRole('button', { name: 'Save as stability baseline', exact: true }).click();
      const previousPlan = Object.fromEntries(changed.result.vehicles.map(v => [v.vehicleId, v.slots.map(slot => slot.slotIndex)]));
      scenario = { ...scenario, previousPlan };
      await expect.poll(() => page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? '{}').previousPlan, HOME_SCENARIO_KEY))
        .toEqual(previousPlan);
      await assertPlan(page, scenario);
      const historyReads = reads.get(historyPath);
      await page.clock.setFixedTime(new Date(HOME_REANCHOR));
      await page.getByRole('button', { name: 'Recompute from now', exact: true }).click();
      await assertPlan(page, scenario, HOME_REANCHOR);
      expect(reads.get(historyPath), 're-anchor is not a history endpoint retry').toBe(historyReads);
      await assertQuality(page, expectedHomePlan(scenario, HOME_REANCHOR));
      await expectNoHorizontalOverflow(page);
      await expectNoRuntimeFailures(diagnostics);
      await assertMockApiComplete(page, mocks);
    });

    test(`supported home held then failed history leaves resolved siblings and modeled assumptions ${theme} ${width}`, async ({ page }) => {
      test.setTimeout(120_000);
      const { mocks, diagnostics, reads, get } = await setup(page, theme, width);
      let releaseHistory: () => void = () => { throw new Error('History hold not installed'); };
      const held = new Promise<void>(resolve => { releaseHistory = resolve; });
      let failed = true;
      await get(historyPath, async () => {
        await held;
        return failed
          ? { status: 503, json: { error: 'Supported history source unavailable' } }
          : { status: 200, json: homeHistory };
      }, { period: 'day' });
      try {
        await page.goto('/energy-orchestrator');
        await assertSiblings(mocks);
        await assertSections(page);
        await expect.poll(() => reads.get(historyPath) ?? 0).toBeGreaterThan(0);
        const quality = page.getByTestId('home-energy-forecast-quality');
        await expect(quality).toContainText('Loading source inputs');
        const assumed = await assertPlan(page, homeScenario(), HOME_ANCHOR, []);
        expect(assumed.input.vehicles[0].currentSocPct).toBe(30);
        expect(assumed.input.powerwall?.currentSocPct).toBe(60);
        await expect(page.getByRole('slider', { name: 'Horizon', exact: true })).toBeEnabled();
        releaseHistory();
        const historySource = page.locator('[data-home-energy-source="history"]');
        await expect(historySource.getByRole('button', { name: /Retry/i })).toBeVisible();
        await expect(quality).toContainText('Incomplete source inputs');
        await assertQuality(page, assumed);
        await assertPlan(page, homeScenario(), HOME_ANCHOR, []);
        await assertSections(page);
        const attempts = reads.get(historyPath);
        await page.clock.setFixedTime(new Date(HOME_REANCHOR));
        await page.getByRole('button', { name: 'Recompute from now', exact: true }).click();
        await assertPlan(page, homeScenario(), HOME_REANCHOR, []);
        expect(reads.get(historyPath), 'Recompute cannot recover failed source history').toBe(attempts);
        await expect(historySource.getByRole('button', { name: /Retry/i })).toBeVisible();
        await assertSiblings(mocks);
        failed = false;
        await historySource.getByRole('button', { name: /Retry/i }).click();
        const recovered = expectedHomePlan(homeScenario(), HOME_REANCHOR);
        await assertQuality(page, recovered);
        await assertPlan(page, homeScenario(), HOME_REANCHOR);
        expect(reads.get(historyPath) ?? 0).toBeGreaterThan(attempts ?? 0);
        await expect(historySource.getByRole('button', { name: /Retry/i })).toHaveCount(0);
        await waitForHarnessReady(page, mocks);
        await expectThemeApplied(page, theme);
        await expectNoHorizontalOverflow(page);
        expect(diagnostics.pageErrors).toEqual([]);
        expect(diagnostics.brokenResources).toEqual([]);
        expect(diagnostics.failedDataRequests.length).toBeGreaterThan(0);
        for (const failure of diagnostics.failedDataRequests)
          expect(failure).toMatch(new RegExp(`^503 (fetch|xhr) .*${historyPath.replaceAll('/', '\\/')}(\\?|$)`));
        for (const error of diagnostics.consoleErrors)
          expect(error).toMatch(/503|Supported history source unavailable/);
        await assertMockApiComplete(page, mocks);
      } finally {
        releaseHistory();
      }
    });
  }
}
