import { expect, test, type Locator, type Page } from '@playwright/test';
import type { ComplianceFiling, CreateFilingRequest } from '../../src/types/ownership';
import {
  assertMockApiComplete, expectThemeApplied, fulfillApiFixture, installApiMocks,
  mockAppSettings, seedBrowserState, waitForHarnessReady, type MockApiController,
} from '../mockApi';
import {
  expectDialogsInsideViewport, expectNoHorizontalOverflow,
  expectNoRuntimeFailures, monitorPage, type PageDiagnostics,
} from '../qualityAssertions';
import {
  complianceReport, consumablesReport, driverReport, evidence, governancePlan,
  governanceReport, insuranceReport, invoice, reconciliationReport, recordedWindow,
  subscription, subscriptionReport, tariff, tariffReplay, trustReport, warrantyReport,
} from './ownership.fixtures';

type ExpectedValue = string | RegExp;
interface MetricCase {
  key: string;
  label: string;
  value: ExpectedValue;
  state?: 'missing';
  context?: ExpectedValue;
}
interface BandCase {
  title: string;
  metrics: readonly MetricCase[];
}
interface RootCase {
  slug: string;
  bands: readonly BandCase[];
  activate?: 'audit' | 'replay' | 'plan';
  windowDays?: number;
}

const distance = /^160\.93\s*km$/;
const energy = /^42(?:\.00)?\s*kWh$/;
const missing = (key: string, label: string): MetricCase => ({ key, label, value: '—', state: 'missing' });
const roots: readonly RootCase[] = [
  {
    slug: 'charging-reconciliation', activate: 'audit', bands: [
      { title: 'Statement amounts and variance', metrics: [
        { key: 'billed', label: 'Billed total', value: '$123.45' },
        { key: 'expected', label: 'Expected from telemetry', value: '$120.00' },
        { key: 'variance', label: 'Net variance', value: '$3.45' },
        { key: 'recoverable', label: 'Disputable amount', value: '$3.45' },
      ] },
      { title: 'Statement matching and energy', metrics: [
        { key: 'matched', label: 'Matched lines', value: '2' },
        { key: 'unmatched', label: 'Unmatched lines', value: '1' },
        { key: 'billedEnergy', label: 'Billed energy', value: energy },
        { key: 'energyVariance', label: 'Energy variance', value: /^2(?:\.00)?\s*kWh$/, context: /40(?:\.00)?\s*kWh/ },
      ] },
    ],
  },
  {
    slug: 'consumables-lifecycle', bands: [
      { title: 'Projected wear and replacement costs', metrics: [
        { key: 'due', label: 'Due soon', value: '2' },
        { key: 'overdue', label: 'Overdue', value: '0' },
        missing('next', 'Next replacement'),
        { key: 'twelve', label: 'Next 12 months', value: '$123.45' },
        { key: 'lifetime', label: 'Spent to date', value: '$678.90' },
        { key: 'stress', label: 'Average duty stress', value: '×1.25' },
      ] },
      { title: 'Blended wear cost and recorded distance', metrics: [
        { key: 'blended', label: 'Blended wear cost', value: '$1.25', context: 'per 1 000 metres driven' },
        { key: 'odometer', label: 'Odometer', value: distance },
        { key: 'parts', label: 'Parts tracked', value: '0' },
      ] },
    ],
  },
  {
    slug: 'data-governance', activate: 'plan', bands: [
      { title: 'Governed storage and policy coverage', metrics: [
        { key: 'total', label: 'Total governed footprint', value: '4.0 KiB' },
        { key: 'governed', label: 'Under a policy', value: '2.0 KiB', context: '50.00%' },
        { key: 'ungoverned', label: 'No policy', value: '2.0 KiB' },
        { key: 'holds', label: 'Legal holds', value: '0', context: 'Exempt from every plan' },
        { key: 'mode', label: 'Enforcement mode', value: 'Plan only' },
      ] },
      { title: 'Computed dry-run totals', metrics: [
        { key: 'rows', label: 'Rows in plan', value: '10' },
        { key: 'bytes', label: 'Reclaimable', value: '1.0 KiB' },
        { key: 'fidelity', label: 'Fidelity traded away', value: '0.00%' },
        { key: 'mode', label: 'Executed', value: 'Never — dry run' },
      ] },
    ],
  },
  {
    slug: 'driver-attribution', windowDays: 90, bands: [
      { title: 'Cluster separation and attribution', metrics: [
        { key: 'clusters', label: 'Distinct clusters', value: '0' },
        missing('separation', 'Separation score'),
        { key: 'labelled', label: 'Confirmed drives', value: '5' },
        { key: 'inferred', label: 'Inferred drives', value: '72' },
        { key: 'ambiguous', label: 'Ambiguous drives', value: '3', context: 'Two clusters fit almost equally well' },
      ] },
    ],
  },
  {
    slug: 'insurance-telematics', windowDays: 90, bands: [
      { title: 'Modelled underwriting indices', metrics: [
        { key: 'score', label: 'Risk score', value: '25.00', context: '0 = best, 100 = worst' },
        { key: 'frequency', label: 'Frequency index', value: '0.80' },
        { key: 'severity', label: 'Severity index', value: '1.25' },
        { key: 'losscost', label: 'Loss cost index', value: '1.00' },
      ] },
      { title: 'Recorded driving exposure', metrics: [
        { key: 'exposure', label: 'Exposure distance', value: distance, context: '12 drives' },
        { key: 'duration', label: 'Time behind the wheel', value: /^2(?:\.00)?\s*h$/ },
        { key: 'night', label: 'Night distance', value: /^16\.09\s*km$/, context: '10.00%' },
        missing('percentile', 'Peer percentile'),
      ] },
      { title: 'Policy-based premium model', metrics: [
        { key: 'baseline', label: 'Baseline annual premium', value: '$1,200.00' },
        { key: 'modelled', label: 'Modelled annual premium', value: '$960.00' },
        { key: 'delta', label: 'Difference', value: '-$240.00', context: '-20.00%' },
        { key: 'discount', label: 'Applied discount', value: '20.00%', context: 'Cap 25.00%' },
      ] },
      { title: 'Policy loss and distance costs', metrics: [
        missing('expected', 'Expected annual loss'),
        { key: 'deductible', label: 'Deductible', value: '$500.00' },
        { key: 'perDistance', label: 'Cost per distance', value: '$1.25 / 1000 m' },
      ] },
    ],
  },
  {
    slug: 'jurisdiction-compliance', windowDays: 90, bands: [
      { title: 'Recorded period liability', metrics: [
        { key: 'distance', label: 'Total distance', value: distance, context: '12 drives' },
        { key: 'assigned', label: 'Assigned to a jurisdiction', value: /^144\.84\s*km$/ },
        { key: 'unassigned', label: 'Unassigned', value: /^16\.09\s*km$/, context: '10.00%' },
        { key: 'roadUsage', label: 'Road-usage charge', value: '$123.45' },
        { key: 'liability', label: 'Total liability', value: '$173.45' },
        { key: 'emissions', label: 'Attributed emissions', value: /^123\.4(?:0)?\s*kg$/ },
      ] },
    ],
  },
  {
    slug: 'model-trust', windowDays: 90, bands: [
      { title: 'Recorded model trust and scoring', metrics: [
        missing('portfolio', 'Portfolio trust score'),
        { key: 'trusted', label: 'Trusted models', value: '2' },
        { key: 'watch', label: 'On watch', value: '1' },
        { key: 'unreliable', label: 'Unreliable', value: '0' },
        { key: 'scored', label: 'Scored / recorded', value: '7.00 / 23.00' },
      ] },
    ],
  },
  {
    slug: 'subscription-roi', windowDays: 180, bands: [
      { title: 'Subscription commitment and realised value', metrics: [
        { key: 'monthly', label: 'Monthly commitment', value: '$25.00' },
        { key: 'spend', label: 'Spent to date', value: '$500.00' },
        { key: 'value', label: 'Realised value', value: '$550.00' },
        { key: 'roi', label: 'Portfolio ROI', value: '+10.00%' },
        { key: 'saving', label: 'Cancel-candidate saving', value: '$12.50', context: 'per month, if all cancelled' },
      ] },
    ],
  },
  {
    slug: 'tariff-lab', activate: 'replay', bands: [
      { title: 'Returned tariff replay comparison', metrics: [
        { key: 'saving', label: 'Best-case annual saving', value: '$123.45', context: 'Recorded alternative plan' },
        { key: 'observed', label: 'Observed energy', value: energy, context: '12 sessions' },
        { key: 'plans', label: 'Plans evaluated', value: '2' },
        { key: 'shift', label: 'Shiftable share modelled', value: '35.00%' },
      ] },
    ],
  },
  {
    slug: 'warranty-command', bands: [
      { title: 'Recorded warranty coverage and expiry', metrics: [
        { key: 'active', label: 'Active coverages', value: '3' },
        { key: 'expiring', label: 'Expiring within 90 days', value: '0' },
        missing('next', 'Next expiry'),
        { key: 'odometer', label: 'Odometer', value: distance, context: 'Derived from recorded drives' },
        { key: 'claimed', label: 'Total claimed', value: '$432.10' },
      ] },
    ],
  },
];

const controllers = new WeakMap<Page, MockApiController>();
const diagnostics = new WeakMap<Page, PageDiagnostics>();
test.use({ timezoneId: 'UTC', locale: 'en-US' });
test.afterEach(async ({ page }) => {
  const api = controllers.get(page);
  const problems = diagnostics.get(page);
  const results = await Promise.allSettled([
    ...(api ? [assertMockApiComplete(page, api)] : []),
    ...(problems ? [expectNoRuntimeFailures(problems)] : []),
  ]);
  const failures = results.flatMap((result) => result.status === 'rejected' ? [result.reason] : []);
  if (failures.length) throw new AggregateError(failures, 'Ownership API completion/runtime contract');
});

async function fixture(
  page: Page, api: MockApiController, endpoint: string, body: unknown,
  params: Record<string, string> = {}, method = 'GET',
): Promise<void> {
  await page.route((url) => url.pathname === `/api/v1${endpoint}`, async (route) => {
    expect(route.request().method(), endpoint).toBe(method);
    const search = new URL(route.request().url()).searchParams;
    expect(Object.fromEntries(search), `${endpoint} query contract`).toEqual(params);
    await fulfillApiFixture(route, api, { json: body });
  });
}

async function setup(
  page: Page, slug: string, theme: 'light' | 'dark' = 'dark',
  length: 'km' | 'mi' = 'km', currency = 'USD',
): Promise<MockApiController> {
  const path = `/ownership/${slug}`;
  diagnostics.set(page, monitorPage(page));
  await seedBrowserState(page, theme, path);
  const api = await installApiMocks(page, 'populated', theme);
  if (!api) throw new Error('Ownership source contracts require the strict mocked harness');
  controllers.set(page, api);
  await fixture(page, api, '/settings', {
    ...mockAppSettings, mode: theme, unit_of_length: length,
  });
  const vehicle = { vehicle_id: '7' };
  const window = { ...vehicle, window_days: slug === 'subscription-roi' ? '180' : '90' };
  switch (slug) {
    case 'charging-reconciliation':
      await fixture(page, api, '/charging-reconciliation/invoices', {
        items: [invoice], total: 81, limit: 50, offset: 0,
      }, { ...vehicle, limit: '50', offset: '0' });
      await fixture(page, api, '/charging-reconciliation/invoices/801/report', reconciliationReport);
      break;
    case 'consumables-lifecycle':
      await fixture(page, api, '/consumables-lifecycle', { ...consumablesReport, currency }, vehicle);
      await fixture(page, api, '/consumables-lifecycle/items', { items: [], total: 0 }, vehicle);
      break;
    case 'data-governance':
      await fixture(page, api, '/data-governance', governanceReport);
      await fixture(page, api, '/data-governance/runs', {
        items: [], total: 0, limit: 50, offset: 0,
      }, { limit: '50', offset: '0' });
      await page.route((url) => url.pathname === '/api/v1/data-governance/simulate', async (route) => {
        expect(route.request().method()).toBe('POST');
        expect(route.request().postDataJSON()).toEqual({ datasets: ['signal_log'], confirmed: true });
        await fulfillApiFixture(route, api, { json: governancePlan });
      });
      break;
    case 'driver-attribution':
      await fixture(page, api, '/driver-attribution', driverReport, { ...window, limit: '100', offset: '0' });
      await fixture(page, api, '/driver-attribution/profiles', { items: [], total: 0 }, vehicle);
      await fixture(page, api, '/driver-attribution/ghost-drives', { vehicle_id: 7, scanned: 80, ghosts: [] }, window);
      break;
    case 'insurance-telematics':
      await fixture(page, api, '/insurance-telematics', insuranceReport, window);
      break;
    case 'jurisdiction-compliance':
      await fixture(page, api, '/jurisdiction-compliance', complianceReport, window);
      await fixture(page, api, '/jurisdiction-compliance/rates', { items: [], total: 0 });
      await fixture(page, api, '/jurisdiction-compliance/filings', {
        items: [], total: 0, limit: 50, offset: 0,
      }, { ...vehicle, limit: '50', offset: '0' });
      break;
    case 'model-trust':
      await fixture(page, api, '/model-trust', trustReport, window);
      break;
    case 'subscription-roi':
      await fixture(page, api, '/subscription-roi', { ...subscriptionReport, currency }, window);
      await fixture(page, api, '/subscription-roi/subscriptions', { items: [subscription], total: 9 }, vehicle);
      break;
    case 'tariff-lab':
      await fixture(page, api, '/tariff-lab/tariffs', {
        items: [tariff], total: 81, limit: 100, offset: 0,
      }, { limit: '100', offset: '0' });
      await page.route((url) => url.pathname === '/api/v1/tariff-lab/simulate', async (route) => {
        expect(route.request().method()).toBe('POST');
        expect(route.request().postDataJSON()).toEqual({
          vehicle_id: 7, window_days: 90, tariff_ids: [], shiftable_pct: 35,
          switch_fee_minor: 0, confirmed: true,
        });
        await fulfillApiFixture(route, api, { json: tariffReplay });
      });
      break;
    case 'warranty-command':
      await fixture(page, api, '/warranty-command', { ...warrantyReport, currency }, vehicle);
      await fixture(page, api, '/warranty-command/warranties', { items: [], total: 0 }, vehicle);
      break;
    default: throw new Error(`Unleased ownership root ${slug}`);
  }
  return api;
}

function band(page: Page, title: string): Locator {
  return page.locator('main [data-operational-brief]').filter({
    has: page.getByRole('heading', { name: title, exact: true }),
  });
}
function metric(container: Locator, key: string): Locator {
  return container.locator(`[data-operational-metric="${key}"]`);
}
async function expectMetrics(container: Locator, cases: readonly MetricCase[]): Promise<void> {
  await expect(container.getByRole('listitem')).toHaveCount(cases.length);
  for (const entry of cases) {
    const item = metric(container, entry.key);
    await expect(item).toHaveAttribute('data-value-state', entry.state ?? 'value');
    await expect(item).toContainText(entry.label);
    await expect(item.locator('[data-operational-value]')).toHaveText(entry.value);
    if (entry.context) await expect(item).toContainText(entry.context);
  }
}
async function activate(page: Page, root: RootCase): Promise<void> {
  if (root.activate === 'audit') {
    await page.locator('main').getByRole('button', { name: 'Audit', exact: true }).click();
  } else if (root.activate === 'replay') {
    await page.getByRole('button', { name: 'Replay load against plans', exact: true }).click();
  } else if (root.activate === 'plan') {
    await page.getByRole('button', { name: 'Run dry-run plan', exact: true }).click();
  }
}
async function review(page: Page, container: Locator, summary: BandCase): Promise<void> {
  const before = await container.getByRole('list').innerText();
  const trigger = container.getByRole('button', { name: 'Review details', exact: true });
  await trigger.focus();
  await page.keyboard.press('Enter');
  const drawer = page.getByRole('dialog', { name: `${summary.title} details`, exact: true });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole('heading', { name: 'Operational metrics', exact: true })).toBeVisible();
  await expect(drawer).toContainText(summary.title === 'Recorded period liability'
    ? 'Recorded apportionment window'
    : 'Returned source values; model assumptions and limitations remain in the evidence below.');
  for (const entry of summary.metrics) {
    const detail = drawer.locator('[data-drawer-body] .rounded-shape-md').filter({
      has: page.getByText(entry.label, { exact: true }),
    });
    await expect(detail).toHaveCount(1);
    await expect(detail.locator(':scope > div').first().locator('span').last()).toHaveText(entry.value);
    if (entry.context) await expect(detail).toContainText(entry.context);
  }
  await expectDialogsInsideViewport(page);
  await expectNoHorizontalOverflow(page);
  const focusable = drawer.locator('button:visible:not(:disabled), a[href]:visible');
  await focusable.last().focus();
  await page.keyboard.press('Tab');
  await expect(focusable.first()).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(focusable.last()).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect(container.getByRole('list')).toHaveText(before);
}

for (const root of roots) {
  for (const width of [320, 1440]) {
    for (const theme of ['light', 'dark'] as const) {
      test(`${root.slug}: returned summary operands and Review at ${width}px ${theme}`, async ({ page }) => {
        test.setTimeout(90_000);
        await page.setViewportSize({ width, height: 900 });
        const api = await setup(page, root.slug, theme);
        await page.goto(`/ownership/${root.slug}`, { waitUntil: 'domcontentloaded' });
        await waitForHarnessReady(page, api);
        await activate(page, root);
        await waitForHarnessReady(page, api);
        await expectThemeApplied(page, theme);
        await expect(page.locator('main [data-operational-brief]')).toHaveCount(root.bands.length);
        for (const summary of root.bands) {
          const container = band(page, summary.title);
          await expect(container).toBeVisible();
          await expectMetrics(container, summary.metrics);
          if (root.windowDays) {
            await expect(page.getByRole('combobox', { name: 'Analysis window', exact: true }))
              .toHaveValue(String(root.windowDays));
          }
          if (root.slug !== 'jurisdiction-compliance') {
            await expect(container).toContainText('Source returned');
          }
          if (['charging-reconciliation', 'driver-attribution', 'insurance-telematics',
            'jurisdiction-compliance', 'model-trust', 'subscription-roi', 'tariff-lab'].includes(root.slug)) {
            await expect(container).toContainText('May 1, 2026');
            await expect(container).toContainText('Aug 1, 2026');
          } else {
            await expect(container).toContainText('Source as of Aug 1, 2026');
          }
          await review(page, container, summary);
        }
        await expect(page.locator('main').getByText(evidence[0].summary, { exact: true })).toBeVisible();
        await expectNoHorizontalOverflow(page);
      });
    }
  }
}

test('subscription window changes preserve returned totals rather than aggregate the loaded list', async ({ page }) => {
  const api = await setup(page, 'subscription-roi');
  const requestedDays: string[] = [];
  await page.route((url) => url.pathname === '/api/v1/subscription-roi', async (route) => {
    expect(route.request().method()).toBe('GET');
    const params = new URL(route.request().url()).searchParams;
    expect([...params.keys()].sort()).toEqual(['vehicle_id', 'window_days']);
    expect(params.get('vehicle_id')).toBe('7');
    const days = params.get('window_days');
    expect(['180', '30']).toContain(days);
    requestedDays.push(days!);
    await fulfillApiFixture(route, api, { json: {
      ...subscriptionReport,
      window: days === '30' ? { from: '2026-07-01T00:00:00.000Z', to: recordedWindow.to, days: 31 } : recordedWindow,
      total_realised_value_minor: days === '30' ? 2200 : 55000,
      portfolio_roi_pct: days === '30' ? -95.6 : 10,
    } });
  });
  await page.goto('/ownership/subscription-roi');
  await waitForHarnessReady(page, api);
  const summary = band(page, roots[7].bands[0].title);
  await expect(metric(summary, 'spend').locator('[data-operational-value]')).toHaveText('$500.00');
  await page.getByRole('combobox', { name: 'Analysis window', exact: true }).selectOption('30');
  await expect(metric(summary, 'value').locator('[data-operational-value]')).toHaveText('$22.00');
  await expect(metric(summary, 'spend').locator('[data-operational-value]')).toHaveText('$500.00');
  await expect(summary).toContainText('30-day analysis window');
  await expect(summary).toContainText('Recorded bounds');
  await expect(summary).toContainText('Jul 1, 2026');
  await expect(summary).not.toContainText('May 1, 2026');
  await expect(summary).not.toContainText('lifetime coverage');
  expect(requestedDays).toEqual(['180', '30']);
  // Loaded ROI item spends $150; aggregate spends $500. Neither is replaced by $12.50 monthly.
  await expect(page.locator('main').getByText('$150.00', { exact: true }).first()).toBeVisible();
});

for (const value of [null, 0] as const) {
  test(`nullable realised value ${value === null ? 'unknown' : 'zero'} is not coerced`, async ({ page }) => {
    const api = await setup(page, 'subscription-roi');
    await fixture(page, api, '/subscription-roi', {
      ...subscriptionReport, total_realised_value_minor: value, portfolio_roi_pct: value,
    }, { vehicle_id: '7', window_days: '180' });
    await page.goto('/ownership/subscription-roi');
    await waitForHarnessReady(page, api);
    const container = band(page, roots[7].bands[0].title);
    await expectMetrics(container, [
      ...roots[7].bands[0].metrics.slice(0, 2),
      { key: 'value', label: 'Realised value', value: value == null ? '—' : '$0.00', state: value == null ? 'missing' : undefined },
      { key: 'roi', label: 'Portfolio ROI', value: value == null ? '—' : '0.00%', state: value == null ? 'missing' : undefined },
      roots[7].bands[0].metrics[4],
    ]);
  });
}

for (const length of ['km', 'mi'] as const) {
  test(`SI odometer converts once to ${length}; fixed wear-price denominator stays metres`, async ({ page }) => {
    const api = await setup(page, 'consumables-lifecycle', 'dark', length);
    await page.goto('/ownership/consumables-lifecycle');
    await waitForHarnessReady(page, api);
    const economics = band(page, 'Blended wear cost and recorded distance');
    await expect(metric(economics, 'odometer').locator('[data-operational-value]'))
      .toHaveText(length === 'mi' ? /^100(?:\.00)?\s*mi$/ : distance);
    await expect(metric(economics, 'blended').locator('[data-operational-value]')).toHaveText('$1.25');
    await expect(metric(economics, 'blended')).toContainText('per 1 000 metres driven');
    await expect(metric(band(page, roots[1].bands[0].title), 'lifetime')
      .locator('[data-operational-value]')).toHaveText('$678.90');
  });
}

for (const precision of [0, 3]) {
  test(`distance preference precision ${precision} does not round the API or currency operands`, async ({ page }) => {
    const api = await setup(page, 'consumables-lifecycle');
    await fixture(page, api, '/settings', { ...mockAppSettings, mode: 'dark', decimal_precision: precision });
    await page.goto('/ownership/consumables-lifecycle');
    await waitForHarnessReady(page, api);
    const economics = band(page, 'Blended wear cost and recorded distance');
    await expect(metric(economics, 'odometer').locator('[data-operational-value]'))
      .toHaveText(precision === 0 ? '161 km' : '160.934 km');
    await expect(metric(economics, 'blended').locator('[data-operational-value]')).toHaveText('$1.25');
    await expect(metric(band(page, roots[1].bands[0].title), 'twelve')
      .locator('[data-operational-value]')).toHaveText('$123.45');
  });
}

for (const odometer of [null, 0] as const) {
  test(`warranty odometer ${odometer === null ? 'unknown' : 'zero'} stays independent of zero expiring coverages`, async ({ page }) => {
    const api = await setup(page, 'warranty-command');
    await fixture(page, api, '/warranty-command', { ...warrantyReport, odometer_m: odometer }, { vehicle_id: '7' });
    await page.goto('/ownership/warranty-command');
    await waitForHarnessReady(page, api);
    const summary = band(page, 'Recorded warranty coverage and expiry');
    await expect(metric(summary, 'odometer')).toHaveAttribute('data-value-state', odometer == null ? 'missing' : 'value');
    await expect(metric(summary, 'odometer').locator('[data-operational-value]'))
      .toHaveText(odometer == null ? '—' : /^0(?:\.00)?\s*km$/);
    await expect(metric(summary, 'expiring')).toHaveAttribute('data-value-state', 'value');
    await expect(metric(summary, 'expiring').locator('[data-operational-value]')).toHaveText('0');
  });
}

test('ISO minor-unit scale follows the returned denomination, not a universal cents divisor', async ({ page }) => {
  const api = await setup(page, 'consumables-lifecycle', 'light', 'km', 'JPY');
  await page.goto('/ownership/consumables-lifecycle');
  await waitForHarnessReady(page, api);
  const costs = band(page, 'Projected wear and replacement costs');
  await expect(metric(costs, 'twelve').locator('[data-operational-value]')).toHaveText(/^(?:¥|JPY\s*)12,345$/);
  await expect(metric(costs, 'lifetime').locator('[data-operational-value]')).toHaveText(/^(?:¥|JPY\s*)67,890$/);
});

test('tariff replay remains not computed before its actual control publishes results', async ({ page }) => {
  const api = await setup(page, 'tariff-lab');
  await page.goto('/ownership/tariff-lab');
  await waitForHarnessReady(page, api);
  const summary = band(page, 'Returned tariff replay comparison');
  await expect(summary).toContainText('Not computed');
  for (const entry of roots[8].bands[0].metrics) {
    await expect(metric(summary, entry.key)).toHaveAttribute('data-value-state', 'missing');
    await expect(metric(summary, entry.key).locator('[data-operational-value]')).toHaveText('—');
  }
  await activate(page, roots[8]);
  await expectMetrics(summary, roots[8].bands[0].metrics);
  await expect(summary).toContainText('modelled replay results, not a bill');
  await expect(summary).toContainText('Recorded bounds');
});

test('repeating the real tariff replay control retains the last publication while the next response is pending', async ({ page }) => {
  const api = await setup(page, 'tariff-lab');
  let calls = 0;
  let release!: () => void;
  const nextResponse = new Promise<void>((resolve) => { release = resolve; });
  await page.route((url) => url.pathname === '/api/v1/tariff-lab/simulate', async (route) => {
    expect(route.request().method()).toBe('POST');
    expect(route.request().postDataJSON()).toEqual({
      vehicle_id: 7, window_days: 90, tariff_ids: [], shiftable_pct: 35,
      switch_fee_minor: 0, confirmed: true,
    });
    calls += 1;
    if (calls === 2) await nextResponse;
    await fulfillApiFixture(route, api, { json: calls === 1 ? tariffReplay : {
      ...tariffReplay, max_saving_minor: 5432,
    } });
  });
  await page.goto('/ownership/tariff-lab');
  await waitForHarnessReady(page, api);
  await activate(page, roots[8]);
  const summary = band(page, 'Returned tariff replay comparison');
  await expectMetrics(summary, roots[8].bands[0].metrics);
  await activate(page, roots[8]);
  try {
    await expect.poll(() => calls).toBe(2);
    await expectMetrics(summary, roots[8].bands[0].metrics);
    await expect(summary).toContainText('Recorded bounds');
    await expect(summary).not.toContainText('Not computed');
  } finally {
    release();
  }
  await expect(metric(summary, 'saving').locator('[data-operational-value]')).toHaveText('$54.32');
});

test('governance dry-run control publishes a plan, not executed deletion', async ({ page }) => {
  const api = await setup(page, 'data-governance');
  await page.goto('/ownership/data-governance');
  await waitForHarnessReady(page, api);
  const summary = band(page, 'Computed dry-run totals');
  await expect(summary).toContainText('Not computed');
  await expect(metric(summary, 'rows')).toHaveAttribute('data-value-state', 'missing');
  await expect(metric(summary, 'mode').locator('[data-operational-value]')).toHaveText('Never — dry run');
  await activate(page, roots[2]);
  await expectMetrics(summary, roots[2].bands[1].metrics);
  await expect(summary).toContainText('no rows are deleted');
  expect(api.requests.filter((request) => request.method === 'DELETE')).toEqual([]);
});

for (const width of [320, 1440]) {
  test(`statement export preserves loaded-list scope and source minor units at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const api = await setup(page, 'charging-reconciliation');
    await page.goto('/ownership/charging-reconciliation');
    await waitForHarnessReady(page, api);
    const invoiceTable = page.locator('table').filter({ has: page.getByText(invoice.invoice_ref, { exact: true }) });
    const grid = invoiceTable.locator('xpath=ancestor::*[@data-grid-frame][1]');
    await grid.getByRole('button', { name: 'Export list', exact: true }).click();
    const menu = page.getByRole('menu', { name: 'Export list', exact: true });
    const pending = page.waitForEvent('download');
    await menu.getByRole('menuitem', { name: 'Download as JSON', exact: true }).click();
    const download = await pending;
    expect(download.suggestedFilename()).toMatch(/^charging-invoices.*\.json$/);
    const stream = await download.createReadStream();
    if (!stream) throw new Error('Invoice export did not provide its actual download stream');
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    const rows: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    expect(rows).toEqual([{
      invoice_ref: invoice.invoice_ref, provider: invoice.provider,
      period_start: invoice.period_start, period_end: invoice.period_end,
      billed_total_minor: 12345, currency: 'USD', line_count: 3, status: 'open',
    }]);
    // Server list total is 81, but export contains the one loaded statement.
    expect(api.seen.has('GET /charging-reconciliation/invoices?vehicle_id=7&limit=50&offset=0')).toBe(true);
    await expectNoHorizontalOverflow(page);
  });
}

test.describe('independent local business dates', () => {
  test.use({ timezoneId: 'America/Los_Angeles' });
  test('sealing a filing retains date-only inputs without changing the recorded summary window', async ({ page }) => {
    const api = await setup(page, 'jurisdiction-compliance');
    const filings: CreateFilingRequest[] = [];
    await page.route((url) => url.pathname === '/api/v1/jurisdiction-compliance/filings'
      && !url.search, async (route) => {
      expect(route.request().method()).toBe('POST');
      const body = route.request().postDataJSON() as CreateFilingRequest;
      filings.push(body);
      const response: ComplianceFiling = {
        id: 501, vehicle_id: 7, period_start: body.period_start, period_end: body.period_end,
        status: 'sealed', total_distance_m: 160934.4, total_energy_wh: 42000,
        total_charge_minor: 17345, currency: 'USD', digest: complianceReport.digest,
        filed_at: recordedWindow.to, created_at: recordedWindow.to,
      };
      await fulfillApiFixture(route, api, { json: response });
    });
    await page.goto('/ownership/jurisdiction-compliance');
    await waitForHarnessReady(page, api);
    const summary = band(page, 'Recorded period liability');
    const original = await summary.getByRole('list').innerText();
    await page.getByRole('button', { name: 'Seal a period', exact: true }).click();
    await page.getByLabel('Period start', { exact: true }).fill('2026-03-08');
    await page.getByLabel('Period end', { exact: true }).fill('2026-11-01');
    await expect(page.getByLabel('Period start', { exact: true })).toHaveValue('2026-03-08');
    await expect(page.getByLabel('Period end', { exact: true })).toHaveValue('2026-11-01');
    await page.getByRole('button', { name: 'Seal period', exact: true }).click();
    await expect.poll(() => filings.length).toBe(1);
    expect(filings[0]).toEqual({
      vehicle_id: 7, period_start: '2026-03-08T00:00:00.000Z',
      period_end: '2026-11-01T00:00:00.000Z', confirmed: true,
    });
    await expect(summary.getByRole('list')).toHaveText(original);
    await expect(page.getByRole('combobox', { name: 'Analysis window', exact: true })).toHaveValue('90');
    await expectNoHorizontalOverflow(page);
  });
});

for (const width of [320, 1440]) {
  test(`real ownership navigation preserves destination source and back navigation at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const api = await setup(page, 'subscription-roi');
    await fixture(page, api, '/tariff-lab/tariffs', {
      items: [tariff], total: 1, limit: 100, offset: 0,
    }, { limit: '100', offset: '0' });
    await page.goto('/ownership/subscription-roi');
    await waitForHarnessReady(page, api);
    if (width < 1280) await page.getByRole('button', { name: 'Open sidebar', exact: true }).click();
    const rail = page.getByRole('navigation', { name: 'Sections and shortcuts' });
    await rail.getByRole('button', { name: /Ownership intelligence, \d+ pages/ }).click();
    const nav = page.getByRole('navigation', { name: 'Sidebar navigation' });
    await nav.getByRole('button', { name: 'Expand all groups', exact: true }).click();
    const link = nav.locator('a[href="/ownership/tariff-lab"]').first();
    await expect(link).toBeVisible();
    await link.click();
    await expect(page).toHaveURL(/\/ownership\/tariff-lab$/);
    await waitForHarnessReady(page, api);
    await expect(band(page, 'Returned tariff replay comparison')).toContainText('Not computed');
    await page.goBack();
    await expect(page).toHaveURL(/\/ownership\/subscription-roi$/);
    await waitForHarnessReady(page, api);
    await expectMetrics(band(page, roots[7].bands[0].title), roots[7].bands[0].metrics);
    await expectNoHorizontalOverflow(page);
  });
}
