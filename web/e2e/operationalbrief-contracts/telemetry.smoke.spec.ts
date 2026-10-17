import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  assertMockApiComplete, expectThemeApplied, installApiMocks, seedBrowserState, waitForHarnessReady,
} from '../mockApi';
import {
  expectDialogsInsideViewport, expectNoHorizontalOverflow, monitorPage,
} from '../qualityAssertions';
import {
  HISTORY_FROM, HISTORY_ROWS, HISTORY_TO, installEndedTailFixture, installTelemetryFixtures,
} from './telemetry.fixtures';

const LAYOUTS = [
  { width: 320, theme: 'light' },
  { width: 320, theme: 'dark' },
  { width: 1440, theme: 'light' },
  { width: 1440, theme: 'dark' },
] as const;
const expectedLayouts = new WeakMap<Page, typeof LAYOUTS[number]>();
const RANGE = 'vehicle_id=7&from=2026-08-27&to=2026-08-28';
const HISTORY_SCOPE = 'Analysis covers returned numeric samples, not guaranteed full-window coverage.';
const BUFFER_SCOPE = 'Current bounded SSE tail buffer only; cleared and replaced independently of durable history.';

function metric(brief: Locator, key: string): Locator {
  return brief.locator(`[data-operational-metric="${key}"]`);
}

async function expectMetric(brief: Locator, key: string, value: string | RegExp): Promise<void> {
  const cell = metric(brief, key);
  await expect(cell).toHaveAttribute('data-value-state', 'value');
  await expect(cell.locator('[data-operational-value]')).toHaveText(value);
}

async function expectMissing(brief: Locator, key: string): Promise<void> {
  const cell = metric(brief, key);
  await expect(cell).toHaveAttribute('data-value-state', 'missing');
  await expect(cell.locator('[data-operational-value]')).toHaveText('—');
}

async function reviewBrief(page: Page, brief: Locator, detail: string): Promise<void> {
  const layout = expectedLayouts.get(page);
  if (!layout) throw new Error('The page must use the strict telemetry layout setup');
  await expectThemeApplied(page, layout.theme);
  expect(page.viewportSize()?.width).toBe(layout.width);
  await expect(brief).toHaveAttribute('data-operational-brief', 'true');
  await expect(brief.getByRole('list')).toHaveClass(/\bgrid-cols-1\b/);
  const publication = await brief.locator('[data-operational-value]').allTextContents();
  const evidence = await brief.locator('[data-operational-metric]').allTextContents();
  const trigger = brief.getByRole('button', { name: 'Review details', exact: true });
  await trigger.focus();
  await page.keyboard.press('Enter');
  const drawer = page.getByRole('dialog');
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole('heading', { name: 'Operational metrics', exact: true })).toBeVisible();
  await expect(drawer).toContainText(detail);
  for (const value of publication) await expect(drawer).toContainText(value);
  for (const text of evidence) await expect(drawer).toContainText(text);
  await page.keyboard.press('Tab');
  expect(await drawer.evaluate(node => node.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Shift+Tab');
  expect(await drawer.evaluate(node => node.contains(document.activeElement))).toBe(true);
  await expectDialogsInsideViewport(page);
  await expectNoHorizontalOverflow(page);
  await page.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);
  await expect(trigger).toBeFocused();
  expect(await brief.locator('[data-operational-value]').allTextContents()).toEqual(publication);
}

async function setup(
  page: Page,
  layout: typeof LAYOUTS[number],
  path: string,
) {
  if (process.env.E2E_MOCKS === '0') throw new Error('Telemetry source contracts require E2E_MOCKS enabled');
  expectedLayouts.set(page, layout);
  await page.setViewportSize({ width: layout.width, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await seedBrowserState(page, layout.theme, path);
  const mocks = await installApiMocks(page, 'populated', layout.theme);
  const fixtures = await installTelemetryFixtures(page, mocks);
  const diagnostics = monitorPage(page);
  return { mocks, fixtures, diagnostics };
}

const ANALYSIS_CASES = [
  { path: '/signal-trend', id: 'signal-trend-summary', selector: 'Signal', keys: ['drift-rate', 'significance', 'spread', 'samples'], zeroKey: 'spread', paired: false, hours: 168, analysis: true },
  { path: '/signal-entropy', id: 'signal-entropy-summary', selector: 'Signal', keys: ['entropy', 'effective-states', 'dominant-state', 'change-rate'], zeroKey: 'entropy', paired: false, hours: 48, analysis: true },
  { path: '/signal-change-points', id: 'signal-change-points-summary', selector: 'Signal', keys: ['change-points', 'biggest-shift', 'segments', 'samples'], zeroKey: 'change-points', paired: false, hours: 72, analysis: true },
  { path: '/signal-deadband', id: 'signal-deadband-summary', selector: 'Numeric signal', keys: ['noise', 'redundant', 'threshold', 'reduction'], zeroKey: 'noise', paired: false, hours: 24, analysis: false },
  { path: '/signal-mutual-information', id: 'signal-mutual-information-summary', selector: 'Signal A', keys: ['aligned-samples', 'mutual-information', 'normalized-mi', 'permutation-test'], zeroKey: 'mutual-information', paired: true, hours: 24, analysis: false },
  { path: '/signal-correlation', id: 'signal-correlation-summary', selector: 'Signal A', keys: ['peak-r', 'best-lag', 'significance', 'effective-n'], zeroKey: 'peak-r', paired: true, hours: 24, analysis: false },
] as const;

async function selectAnalysis(page: Page, fixture: typeof ANALYSIS_CASES[number]): Promise<void> {
  await page.getByRole('combobox', { name: fixture.selector, exact: true }).selectOption('BatteryLevel');
  if (fixture.paired) await page.getByRole('combobox', { name: 'Signal B', exact: true }).selectOption('VehicleSpeed');
}

for (const layout of LAYOUTS) {
  for (const analysis of ANALYSIS_CASES) {
    test(`${analysis.path}: unselected history is unknown and Review preserves evidence at ${layout.width}px ${layout.theme}`, async ({ page }) => {
      const path = `${analysis.path}?${RANGE}`;
      const { mocks, diagnostics } = await setup(page, layout, path);
      await page.goto(path);
      await waitForHarnessReady(page, mocks);
      const brief = page.getByTestId(analysis.id);
      await expect(brief).toHaveAttribute('data-operational-brief', 'true');
      for (const key of analysis.keys) await expectMissing(brief, key);
      await expect(brief).toContainText('Source values unknown');
      await reviewBrief(page, brief, analysis.path === '/signal-correlation'
        ? 'Only valid overlapping samples contribute' : HISTORY_SCOPE);
      await expectNoHorizontalOverflow(page);
      expect(diagnostics.pageErrors).toEqual([]);
      await assertMockApiComplete(page, mocks);
    });

    // These assertions intentionally use the real typed wire shape. The
    // current scientific consumers still read legacy valueNum/value_numeric;
    // their source blocker is recorded in the handoff, not hidden by fixtures.
    test(`${analysis.path}: returned typed numeric zero is not unknown at ${layout.width}px ${layout.theme}`, async ({ page }) => {
      const path = `${analysis.path}?${RANGE}`;
      const { mocks, fixtures, diagnostics } = await setup(page, layout, path);
      await page.goto(path);
      await waitForHarnessReady(page, mocks);
      await selectAnalysis(page, analysis);
      await waitForHarnessReady(page, mocks);
      expect(fixtures.historyRequests).toHaveLength(analysis.paired ? 2 : 1);
      for (const request of fixtures.historyRequests) {
        expect(request.searchParams.get('hours')).toBe(String(analysis.hours));
        if (analysis.analysis) expect(request.searchParams.get('limit')).toBe('10000');
      }
      const brief = page.getByTestId(analysis.id);
      await expectMetric(brief, analysis.zeroKey, analysis.path === '/signal-entropy'
        ? /^0(?:\.0+)? bits$/ : /^0(?:\.0+)?$/);
      if (analysis.path === '/signal-trend' || analysis.path === '/signal-change-points') {
        await expectMetric(brief, 'samples', String(HISTORY_ROWS));
      }
      if (analysis.path === '/signal-change-points') {
        await expectMissing(brief, 'biggest-shift');
        await expectMetric(brief, 'segments', '1');
      }
      if (analysis.path === '/signal-deadband') {
        const audit = page.getByTestId('signal-deadband-retention-summary');
        await expectMetric(audit, 'samples', String(HISTORY_ROWS));
        await reviewBrief(page, audit, 'simulated against the last retained value');
      }
      await reviewBrief(page, brief, analysis.path === '/signal-correlation'
        ? 'Autocorrelation-adjusted effective sample size' : HISTORY_SCOPE);
      expect(diagnostics.pageErrors).toEqual([]);
      await assertMockApiComplete(page, mocks);
    });
  }

  test(`SSE transport can be connected with a genuinely empty bounded tail at ${layout.width}px ${layout.theme}`, async ({ page }) => {
    const path = `/live-monitor?${RANGE}`;
    const { mocks, diagnostics } = await setup(page, layout, path);
    await page.goto(path);
    await waitForHarnessReady(page, mocks);
    const brief = page.getByTestId('live-monitor-summary');
    await expectMetric(brief, 'connection', 'Connected');
    for (const key of ['rate', 'buffer', 'unique', 'numeric', 'categorical']) {
      await expectMetric(brief, key, '0');
    }
    await expect(metric(brief, 'connection')).toContainText('not a vehicle-health or signal-freshness verdict');
    await expect(metric(brief, 'buffer')).toContainText('/ 500');
    await page.getByRole('button', { name: 'Pause', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Resume', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Resume', exact: true }).click();
    await reviewBrief(page, brief, BUFFER_SCOPE);
    expect(diagnostics.pageErrors).toEqual([]);
    await expectNoHorizontalOverflow(page);
    await assertMockApiComplete(page, mocks);
  });

  test(`broker counters remain distinct from SSE tail and per-poll chart deltas at ${layout.width}px ${layout.theme}`, async ({ page }) => {
    const path = `/mqtt-inspector?${RANGE}`;
    const { mocks, diagnostics } = await setup(page, layout, path);
    await page.goto(path);
    await waitForHarnessReady(page, mocks);
    const brief = page.getByTestId('mqtt-summary');
    await expectMetric(brief, 'mqtt-vehicles', '1');
    await expectMetric(brief, 'mqtt-signals', '12');
    await expectMetric(brief, 'mqtt-batches', '3');
    await expectMetric(brief, 'mqtt-rate', /^1\.25(?:\s.*)?$/);
    await expect(page.locator('main').getByRole('table')).toContainText('E2E-SYNTHETIC-TELEMETRY');
    await reviewBrief(page, brief, 'not the throughput chart’s per-poll deltas');
    expect(diagnostics.pageErrors).toEqual([]);
    await expectNoHorizontalOverflow(page);
    await assertMockApiComplete(page, mocks);
  });

  test(`ended native SSE retains its bounded mixed-value tail, and Clear is not a durable-history mutation at ${layout.width}px ${layout.theme}`, async ({ page }) => {
    const path = `/live-monitor?${RANGE}`;
    const { mocks, diagnostics } = await setup(page, layout, path);
    const publish = await installEndedTailFixture(page, mocks);
    await page.goto(path);
    await waitForHarnessReady(page, mocks);
    const brief = page.getByTestId('live-monitor-summary');
    await expect(brief).toBeVisible();
    publish();
    await waitForHarnessReady(page, mocks);
    await expectMetric(brief, 'connection', 'Disconnected');
    await expectMetric(brief, 'buffer', '3');
    await expectMetric(brief, 'unique', '3');
    await expectMetric(brief, 'numeric', '1');
    await expectMetric(brief, 'categorical', '2');
    let quietRateSamples = 0;
    await expect.poll(async () => {
      const rate = await metric(brief, 'rate').locator('[data-operational-value]').textContent();
      quietRateSamples = rate === '0' ? quietRateSamples + 1 : 0;
      return quietRateSamples;
    }, { intervals: [1000], timeout: 10_000 }).toBeGreaterThanOrEqual(2);
    await expect(brief).toContainText('Retained source data');
    const table = page.locator('main').getByRole('table');
    const battery = table.getByRole('row').filter({ hasText: 'BatteryLevel' });
    const presence = table.getByRole('row').filter({ hasText: 'IsUserPresent' });
    await expect(battery.getByRole('cell', { name: '0', exact: true })).toBeVisible();
    await expect(presence.getByRole('cell', { name: 'false', exact: true })).toBeVisible();
    await reviewBrief(page, brief, BUFFER_SCOPE);
    await page.getByRole('textbox', { name: 'Filter signals', exact: true }).fill('BatteryLevel');
    await expect(table.getByRole('row').filter({ hasText: 'IsUserPresent' })).toHaveCount(0);
    await expectMetric(brief, 'buffer', '3');
    await page.getByRole('button', { name: 'Clear', exact: true }).click();
    await expectMetric(brief, 'buffer', '0');
    await expectMetric(brief, 'unique', '0');
    await expect(brief).not.toContainText('Retained source data');
    expect(mocks?.requests.filter(request =>
      request.path.includes('/history') || request.method !== 'GET' && !request.path.startsWith('/api/v1/web-'),
    )).toEqual([]);
    expect(diagnostics.pageErrors).toEqual([]);
    await expectNoHorizontalOverflow(page);
    await assertMockApiComplete(page, mocks);
  });

  test(`gap denominator includes never-received signals and refresh retains publication at ${layout.width}px ${layout.theme}`, async ({ page }) => {
    const path = `/signal-gaps?${RANGE}`;
    const { mocks, fixtures, diagnostics } = await setup(page, layout, path);
    await page.goto(path);
    await waitForHarnessReady(page, mocks);
    const brief = page.getByTestId('signal-gap-summary');
    await expectMetric(brief, 'total', '4');
    for (const key of ['active', 'aging', 'stale', 'never']) await expectMetric(brief, key, '1');
    await expectMetric(brief, 'freshness', '50%');
    await expect(brief).toContainText('2 of 4 signals arriving');
    await reviewBrief(page, brief, 'a sleeping vehicle can be stale without being unhealthy');
    const beforeRefresh = fixtures.liveRequests;
    fixtures.holdNextLive();
    try {
      await page.getByRole('button', { name: 'Refresh signals', exact: true }).click();
      await expect.poll(() => fixtures.liveRequests).toBeGreaterThan(beforeRefresh);
      await expect(brief).toContainText('Retained source data');
      await expectMetric(brief, 'total', '4');
      await expectMetric(brief, 'freshness', '50%');
    } finally {
      fixtures.releaseLive();
    }
    await waitForHarnessReady(page, mocks);
    await expectMetric(brief, 'total', '4');
    await expect(page.getByTestId('signal-catalog-summary')).toHaveCount(0);
    expect(diagnostics.pageErrors).toEqual([]);
    await expectNoHorizontalOverflow(page);
    await assertMockApiComplete(page, mocks);
  });

  for (const surface of [
    { path: '/signal-log', id: 'signal-log-summary', submit: 'Query' },
    { path: '/signal-explorer', id: 'signal-explorer-summary', submit: 'Explore' },
  ] as const) {
    test(`${surface.path}: submitted history counts returned rows, not the requested span at ${layout.width}px ${layout.theme}`, async ({ page }) => {
      const path = `${surface.path}?${RANGE}&signals=BatteryLevel`;
      const { mocks, fixtures, diagnostics } = await setup(page, layout, path);
      await page.goto(path);
      await waitForHarnessReady(page, mocks);
      const brief = page.getByTestId(surface.id);
      await expectMissing(brief, 'records');
      await expectMetric(brief, 'signals', '1');
      await page.locator('main').getByRole('button', { name: surface.submit, exact: true }).click();
      await waitForHarnessReady(page, mocks);
      await expectMetric(brief, 'records', String(HISTORY_ROWS));
      expect(fixtures.historyRequests.length).toBeGreaterThan(0);
      for (const request of fixtures.historyRequests) {
        expect(request.searchParams.has('from')).toBe(true);
        expect(request.searchParams.has('to')).toBe(true);
        expect(request.searchParams.has('vehicleId')).toBe(false);
      }
      if (surface.path === '/signal-log') {
        await expectMetric(brief, 'numeric', String(HISTORY_ROWS));
        await expectMetric(brief, 'text', '0');
        await expectMetric(brief, 'boolean', '0');
        await expectMetric(brief, 'span', '39m');
        const agreement = page.getByTestId('transport-agreement-summary');
        await expectMetric(agreement, 'agreement', /^99\.5(?:0)?%$/);
        await expectMetric(agreement, 'pairs', '200');
        await expectMetric(agreement, 'http', '201');
        await expectMetric(agreement, 'mqtt', '201');
        await reviewBrief(page, agreement, 'Producer time only; receipt fallbacks excluded');
      }
      await reviewBrief(page, brief, 'not a server-wide total or proof of complete time-window coverage');
      expect(diagnostics.pageErrors).toEqual([]);
      await expectNoHorizontalOverflow(page);
      await assertMockApiComplete(page, mocks);
    });
  }

  test(`snapshot diff retains raw zero, fractional SI change and independent pins at ${layout.width}px ${layout.theme}`, async ({ page }) => {
    const path = `/signal-diff?vehicle=7&a=${HISTORY_FROM}&b=${HISTORY_TO}`;
    const { mocks, diagnostics } = await setup(page, layout, path);
    await page.goto(path);
    await waitForHarnessReady(page, mocks);
    const brief = page.getByTestId('signal-diff-page-summary');
    await expectMetric(brief, 'changed', '2');
    await expectMetric(brief, 'visible', '2');
    await expectMetric(brief, 'numeric', '2');
    await expectMetric(brief, 'pinned', '0');
    await expectMetric(brief, 'window-span', '24h');
    const speedRow = page.locator('main').getByRole('row').filter({ hasText: 'VehicleSpeed' });
    await expect(speedRow.getByRole('cell', { name: '0.00', exact: true })).toBeVisible();
    await expect(speedRow.getByRole('cell', { name: '2.50', exact: true })).toBeVisible();
    await expect(speedRow.getByRole('cell', { name: '+2.50', exact: true })).toBeVisible();
    const filter = page.getByRole('searchbox', { name: 'Filter signals', exact: true });
    await filter.fill('VehicleSpeed');
    await expectMetric(brief, 'changed', '2');
    await expectMetric(brief, 'visible', '1');
    await expectMetric(brief, 'numeric', '1');
    await expectMetric(brief, 'pinned', '0');
    await filter.fill('not-in-either-snapshot');
    await expectMetric(brief, 'changed', '2');
    for (const key of ['visible', 'numeric', 'categories']) await expectMetric(brief, key, '0');
    await reviewBrief(page, brief, 'not a sample coverage duration');
    expect(diagnostics.pageErrors).toEqual([]);
    await expectNoHorizontalOverflow(page);
    await assertMockApiComplete(page, mocks);
  });

  test(`workspace mode separates live rate, tail and snapshot comparison at ${layout.width}px ${layout.theme}`, async ({ page }) => {
    const path = `/signals?${RANGE}&signals=BatteryLevel&a=${HISTORY_FROM}&b=${HISTORY_TO}`;
    const { mocks, diagnostics } = await setup(page, layout, path);
    await page.goto(path);
    await waitForHarnessReady(page, mocks);
    const brief = page.getByTestId('signals-workspace-summary');
    await expectMetric(brief, 'signals-selected', '1');
    await expectMetric(brief, 'signals-mode', 'Historical');
    await expectMissing(brief, 'signals-live-rate');
    await reviewBrief(page, brief, 'Live stream is not active');
    await page.locator('main').getByRole('button', { name: 'Live', exact: true }).click();
    await waitForHarnessReady(page, mocks);
    await expectMetric(brief, 'signals-mode', 'Live');
    await expectMetric(brief, 'signals-live-rate', /^0(?:\.0+)?\s*\/s$/);
    const tail = page.getByTestId('live-tail-summary');
    for (const key of ['rate', 'buffer', 'unique', 'filtered']) await expectMetric(tail, key, '0');
    await reviewBrief(page, tail, BUFFER_SCOPE);
    await page.locator('main').getByRole('button', { name: 'Compare', exact: true }).click();
    await waitForHarnessReady(page, mocks);
    await expectMetric(brief, 'signals-mode', 'Compare');
    await expectMissing(brief, 'signals-live-rate');
    await expect(tail).toHaveCount(0);
    const diff = page.getByTestId('signals-diff-summary');
    await expectMetric(diff, 'signals-diff-changed', '2');
    await expectMetric(diff, 'signals-diff-visible', '2');
    await expectMetric(diff, 'signals-diff-pinned', '0');
    await page.getByRole('searchbox', { name: 'Filter signals', exact: true }).fill('VehicleSpeed');
    await expectMetric(diff, 'signals-diff-changed', '2');
    await expectMetric(diff, 'signals-diff-visible', '1');
    await expectMetric(diff, 'signals-diff-pinned', '0');
    await reviewBrief(page, diff, 'pins describe current workspace state');
    expect(diagnostics.pageErrors).toEqual([]);
    await expectNoHorizontalOverflow(page);
    await assertMockApiComplete(page, mocks);
  });
}

test('transport missing overlap is unknown agreement while a queried empty history is valid zero', async ({ page }) => {
  const path = `/signal-log?${RANGE}&signals=BatteryLevel`;
  const { mocks, fixtures, diagnostics } = await setup(page, LAYOUTS[0], path);
  fixtures.emptyHistory = true;
  fixtures.agreementMode = 'insufficient_overlap';
  await page.goto(path);
  await waitForHarnessReady(page, mocks);
  const brief = page.getByTestId('signal-log-summary');
  await expectMissing(brief, 'records');
  await page.locator('main').getByRole('button', { name: 'Query', exact: true }).click();
  await waitForHarnessReady(page, mocks);
  for (const key of ['records', 'numeric', 'text', 'boolean']) await expectMetric(brief, key, '0');
  await expectMissing(brief, 'span');
  const agreement = page.getByTestId('transport-agreement-summary');
  await expectMissing(agreement, 'agreement');
  await expectMetric(agreement, 'pairs', '0');
  await expectMetric(agreement, 'http', '0');
  await expectMetric(agreement, 'mqtt', '5');
  await reviewBrief(page, agreement, 'missing overlap is unknown, not zero agreement');
  expect(diagnostics.pageErrors).toEqual([]);
  await assertMockApiComplete(page, mocks);
});

for (const brokerState of ['empty', 'unavailable'] as const) {
  test(`broker ${brokerState} is not confused with the other source state`, async ({ page }) => {
    test.setTimeout(60_000);
    const path = '/mqtt-inspector?vehicle_id=7';
    const { mocks, fixtures, diagnostics } = await setup(page, LAYOUTS[0], path);
    fixtures.brokerEmpty = brokerState === 'empty';
    fixtures.brokerUnavailable = brokerState === 'unavailable';
    await page.goto(path);
    await waitForHarnessReady(page, mocks);
    const brief = page.getByTestId('mqtt-summary');
    for (const key of ['mqtt-vehicles', 'mqtt-signals', 'mqtt-batches', 'mqtt-rate']) {
      if (brokerState === 'empty') await expectMetric(brief, key, /^0(?:\.0+)?$/);
      else await expectMissing(brief, key);
    }
    await expect(brief).toContainText(brokerState === 'empty'
      ? 'Broker snapshot available' : 'Broker snapshot unavailable');
    if (brokerState === 'unavailable') {
      expect(diagnostics.failedDataRequests.length).toBeGreaterThan(0);
      for (const failure of diagnostics.failedDataRequests) {
        expect(failure).toMatch(/^503 (?:fetch|xhr) .*\/api\/v1\/telemetry$/);
      }
    } else expect(diagnostics.failedDataRequests).toEqual([]);
    await reviewBrief(page, brief, 'Vehicle totals sum the returned broker counters');
    expect(diagnostics.pageErrors).toEqual([]);
    await assertMockApiComplete(page, mocks);
  });
}

test('a long submitted signal-history window is not shortened to satisfy the agreement cap', async ({ page }) => {
  const path = '/signal-log?vehicle_id=7&from=2026-08-01&to=2026-08-28&signals=BatteryLevel';
  const { mocks, fixtures, diagnostics } = await setup(page, LAYOUTS[3], path);
  await page.goto(path);
  await waitForHarnessReady(page, mocks);
  await page.locator('main').getByRole('button', { name: 'Query', exact: true }).click();
  await waitForHarnessReady(page, mocks);
  await expect(page.getByRole('region', { name: 'HTTP / MQTT agreement', exact: true }))
    .toContainText('Agreement is limited to seven days');
  expect(fixtures.agreementRequests).toEqual([]);
  expect(fixtures.historyRequests).toHaveLength(1);
  const expected = await page.evaluate(() => ({
    from: new Date('2026-08-01T00:00:00').toISOString(),
    to: new Date('2026-08-28T23:59:59.999').toISOString(),
  }));
  expect(fixtures.historyRequests[0]?.searchParams.get('from')).toBe(expected.from);
  expect(fixtures.historyRequests[0]?.searchParams.get('to')).toBe(expected.to);
  const brief = page.getByTestId('signal-log-summary');
  await expectMetric(brief, 'records', String(HISTORY_ROWS));
  await expectMetric(brief, 'span', '39m');
  await reviewBrief(page, brief, 'not the requested range');
  expect(diagnostics.pageErrors).toEqual([]);
  await expectNoHorizontalOverflow(page);
  await assertMockApiComplete(page, mocks);
});
