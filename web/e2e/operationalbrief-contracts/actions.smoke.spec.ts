import { expect, test, type Locator, type Page } from '@playwright/test';
import { ROUTE_REGISTRY } from '../../src/lib/routeRegistry';
import {
  assertMockApiComplete,
  expectThemeApplied,
  installApiMocks,
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
  actionsFixtureState,
  installActionsFixtures,
  NO_RUNS,
  type ActionsFixtureState,
} from './actions.fixtures';

const HISTORY_ROUTE = '/automations/history?vehicle_id=7&from=2026-08-01&to=2026-08-26';
const DOMAIN_PATHS = /^\/api\/v1\/(?:action-center(?:\/|$)|automations(?:\/|$)|benchmarks(?:\/|$)|comfort(?:\/|$))/;

async function openContract(
  page: Page,
  path: string,
  width: number,
  theme: 'light' | 'dark',
  state = actionsFixtureState(),
): Promise<{ mocks: MockApiController; diagnostics: PageDiagnostics; state: ActionsFixtureState }> {
  const pathname = path.split('?')[0];
  expect(ROUTE_REGISTRY.some((route) => route.path === pathname), `Actual application route ${pathname}`).toBe(true);
  await page.setViewportSize({ width, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: theme });
  await seedBrowserState(page, theme, path);
  const mocks = await installApiMocks(page, 'populated', theme);
  if (!mocks) throw new Error('These source contracts may not run against a live backend');
  await installActionsFixtures(page, mocks, state);
  const diagnostics = monitorPage(page);
  await page.goto(path, { waitUntil: 'domcontentloaded' });
  await waitForHarnessReady(page, mocks);
  await expectThemeApplied(page, theme);
  return { mocks, diagnostics, state };
}

async function metric(
  brief: Locator,
  key: string,
  value: string | RegExp,
  valueState: 'value' | 'missing' | 'invalid' = 'value',
): Promise<void> {
  const item = brief.locator(`[data-operational-metric="${key}"]`);
  await expect(item).toHaveCount(1);
  await expect(item).toHaveAttribute('data-value-state', valueState);
  await expect(item.locator('[data-operational-value]')).toHaveText(value);
}

async function review(
  page: Page,
  brief: Locator,
  title: string,
  context: readonly (string | RegExp)[],
): Promise<void> {
  await expect(brief).toHaveAttribute('data-operational-brief', 'true');
  const trigger = brief.getByRole('button', { name: 'Review details', exact: true });
  await trigger.focus();
  await expect(trigger).toBeFocused();
  await page.keyboard.press('Enter');
  const drawer = page.getByRole('dialog', { name: `${title} details`, exact: true });
  await expect(drawer).toBeVisible();
  await expect(drawer).toHaveAttribute('aria-modal', 'true');
  await expect(drawer.getByTestId('operational-narrative')).toBeVisible();
  await expect(drawer).toContainText('Not scored');
  for (const text of context) await expect(drawer).toContainText(text);
  // These actual migrated metrics have no href operands; never invent a metric link.
  await expect(drawer.getByRole('link')).toHaveCount(0);
  const close = drawer.getByRole('button', { name: 'Close', exact: true });
  await expect(close).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(close).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(close).toBeFocused();
  await expectDialogsInsideViewport(page);
  await expectNoHorizontalOverflow(page);
  await page.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await page.keyboard.press('Space');
  await expect(drawer).toBeVisible();
  await drawer.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(drawer).toHaveCount(0);
  await expect(trigger).toBeFocused();
}

async function finish(
  page: Page,
  mocks: MockApiController,
  diagnostics: PageDiagnostics,
): Promise<void> {
  await expectNoHorizontalOverflow(page);
  await expectNoRuntimeFailures(diagnostics);
  expect(mocks.requests.filter((request) => DOMAIN_PATHS.test(request.path) && request.method !== 'GET'),
    'No actuation, consent, release creation, import or rule publication').toEqual([]);
  await assertMockApiComplete(page, mocks);
}

for (const width of [320, 1440]) {
  for (const theme of ['light', 'dark'] as const) {
    test(`action inbox preserves bounded six-count brief, entities and source control ${width}px ${theme}`, async ({ page }) => {
      const { mocks, diagnostics } = await openContract(page, '/action-center?vehicle_id=7', width, theme);
      const brief = page.getByRole('region', { name: 'Decision queue overview', exact: true });
      await expect(brief).toContainText('Summary returned');
      await expect(brief).toContainText('Aurora · Before priority, source, state, and pagination filters');
      for (const [key, value] of [['open', '7'], ['critical', '0'], ['high', '3'], ['acknowledged', '2'], ['snoozed', '1'], ['dismissed', '4']]) {
        await metric(brief, key, value);
      }
      await expect(page.getByRole('heading', { name: 'Source coverage', exact: true })).toBeVisible();
      await expect(page.getByText('Completed charging sessions; provider window is bounded.', { exact: true })).toBeVisible();
      const card = page.getByRole('article').filter({ hasText: 'Review interrupted charging evidence' });
      await expect(card).toHaveCount(1);
      await expect(card).toContainText('73');
      await expect(card.getByRole('button', { name: 'Acknowledge', exact: true })).toBeVisible();
      await expect(card.getByRole('button', { name: 'Dismiss', exact: true })).toBeVisible();
      await expect(card.getByRole('button', { name: 'Open source', exact: true })).toBeVisible();
      await expect(page.getByRole('combobox', { name: 'Priority', exact: true })).toBeVisible();
      await page.getByRole('combobox', { name: 'Priority', exact: true }).selectOption('high');
      await waitForHarnessReady(page, mocks);
      await metric(brief, 'open', '7');
      await expect.poll(() => [...mocks.seen].some((request) => request.includes('priority=high'))).toBe(true);
      await review(page, brief, 'Decision queue overview', [
        'Generated recommendations with critical priority across all inbox states.',
        'Provider-specific evidence windows and limits apply; these counts are not an all-time total.',
        'Server-generated recommendation evidence',
        'inferred',
      ]);
      await card.getByRole('button', { name: 'Evidence, scoring, and outcomes' }).click();
      await expect(card.getByRole('region', { name: 'Projected impact', exact: true })).toContainText('2.50 kWh');
      await expect(card).toContainText('Stored session 201 was interrupted.');
      const source = card.getByRole('button', { name: 'Open source', exact: true });
      await source.focus();
      await expect(source).toBeFocused();
      await finish(page, mocks, diagnostics);
    });

    for (const bulk of [false, true]) {
      test(`automation ${bulk ? 'bulk' : 'entity'} inventory is unfiltered, not execution scope ${width}px ${theme}`, async ({ page }) => {
        const path = bulk ? '/automations/list?vehicle_id=7' : '/automations?vehicle_id=7';
        const { mocks, diagnostics } = await openContract(page, path, width, theme);
        const brief = page.getByTestId(bulk ? 'automation-rules-brief' : 'automations-brief');
        await expect(brief).toContainText('Rules loaded');
        await expect(brief).toContainText('All loaded rules · unfiltered');
        for (const [key, value] of [['total', '3'], ['active', '1'], ['disabled', '1'], ['autoDisabled', '1']]) {
          await metric(brief, key, value);
        }
        if (bulk) {
          await metric(brief, 'runs', '20');
          await metric(brief, 'failures', '3');
          await expect(page.getByRole('table', { name: 'automations:bulk-list', exact: true })).toBeVisible();
        } else {
          await expect(page.getByRole('heading', { name: 'Morning cabin preparation', exact: true })).toBeVisible();
          await expect(page.getByRole('heading', { name: 'Cabin comfort Autopilot', exact: true })).toBeVisible();
          await expect(page.getByRole('switch', { name: 'Toggle automation', exact: true })).toHaveCount(3);
        }
        const status = page.getByRole('combobox', {
          name: bulk ? 'Filter automations by status' : 'Filter by status', exact: true,
        });
        await status.selectOption('active');
        await metric(brief, 'total', '3');
        await expect(page.getByText('Disabled departure reminder', { exact: true })).toHaveCount(0);
        await status.selectOption('all');
        const search = page.getByRole('textbox', { name: bulk ? 'Search automations' : 'Search automations...', exact: true });
        await search.fill('Morning cabin');
        await metric(brief, 'total', '3');
        await expect(page.getByText('Disabled departure reminder', { exact: true })).toHaveCount(0);
        await review(page, brief, 'Rule inventory', [
          'Full loaded rule set, before status and search filters.',
          ...(bulk ? ['Cumulative counters on loaded rules; their start time is not supplied.'] : []),
        ]);
        await expect(search).toHaveValue('Morning cabin');
        await search.fill('');
        await expect(page.getByText('Disabled departure reminder', { exact: true })).toBeVisible();
        await finish(page, mocks, diagnostics);
      });
    }

    test(`automation history uses server range denominators and SI duration ${width}px ${theme}`, async ({ page }) => {
      const { mocks, diagnostics } = await openContract(page, HISTORY_ROUTE, width, theme);
      const brief = page.getByTestId('automation-history-brief');
      await expect(brief).toContainText('Summary loaded');
      await expect(brief).toContainText('inclusive');
      await expect(brief).toContainText('exclusive');
      await expect(brief).toContainText('All rules');
      for (const [key, value] of [['total', '40'], ['success', '30'], ['failed', '8'], ['partial', '2']]) await metric(brief, key, value);
      await metric(brief, 'rate', '75.00%');
      await metric(brief, 'duration', '1.50s');
      await expect(page.getByRole('table', { name: 'Automation history', exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Morning cabin preparation', exact: true })).toHaveCount(25);
      await expect(page.getByRole('link', { name: 'New automation', exact: true })).toHaveAttribute('href', '/automations/new');
      await expect.poll(() => [...mocks.seen].some((request) => {
        const [method, url] = request.split(' ');
        const parsed = new URL(url, 'http://fixture.invalid');
        return method === 'GET' && parsed.pathname === '/automations/history'
          && parsed.searchParams.get('limit') === '25'
          && parsed.searchParams.get('offset') === '0'
          && parsed.searchParams.has('since') && parsed.searchParams.has('until');
      })).toBe(true);
      const historyRequest = [...mocks.seen].find((request) => request.startsWith('GET /automations/history?'));
      expect(historyRequest).toBeDefined();
      const bounds = new URL(historyRequest!.slice(4), 'http://fixture.invalid').searchParams;
      expect(bounds.get('since')).toMatch(/^2026-08-01T/);
      expect(bounds.get('until')).toMatch(/^2026-08-27T/);
      await expect(brief).toContainText(`${bounds.get('since')} inclusive → ${bounds.get('until')} exclusive`);
      await review(page, brief, 'Execution summary', [
        'Server summary across the selected period and rule/status filters, not just this page of rows.',
        '40', '75.00%', '1.50s',
      ]);
      await page.getByRole('combobox', { name: 'Filter executions by rule', exact: true }).selectOption('701');
      await waitForHarnessReady(page, mocks);
      await expect(brief).toContainText('Morning cabin preparation');
      await metric(brief, 'total', '40');
      await expect.poll(() => [...mocks.seen].some((request) => request.startsWith('GET /automations/701/history?'))).toBe(true);
      await finish(page, mocks, diagnostics);
    });

    test(`local automation draft keeps typed forms, readiness and contextual place link ${width}px ${theme}`, async ({ page }) => {
      const { mocks, diagnostics } = await openContract(page, '/automations/new?vehicle_id=7', width, theme);
      const brief = page.getByTestId('automation-builder-brief');
      await expect(brief).toContainText('Not ready yet');
      await expect(brief).toContainText('Editor configuration; not execution history');
      await metric(brief, 'trigger', 'Not set');
      await metric(brief, 'conditions', '0');
      await metric(brief, 'actions', '1');
      await metric(brief, 'status', 'Enabled');
      await expect(page.getByLabel('Name', { exact: true })).toBeVisible();
      await expect(page.getByLabel('Description', { exact: true })).toBeVisible();
      await expect(page.locator('[data-tour="automation-conditions"]')).toBeVisible();
      await expect(page.locator('[data-tour="automation-actions"]')).toBeVisible();
      await page.getByLabel('Name', { exact: true }).fill('Unsaved source regression draft');
      await page.getByRole('combobox', { name: 'Trigger type', exact: true }).selectOption('trigger_geofence');
      await metric(brief, 'trigger', 'Geofence');
      await expect(brief).toContainText('Local changes not published');
      await expect(brief).toContainText('Not ready yet');
      await expect(page.getByRole('link', { name: 'Manage places', exact: true })).toHaveAttribute('href', '/geofences');
      await expect(page.getByRole('combobox', { name: 'Geofence', exact: true })).toBeVisible();
      const enabled = page.getByRole('switch', { name: 'Enabled', exact: true });
      await enabled.focus();
      await page.keyboard.press('Space');
      await expect(enabled).not.toBeChecked();
      await metric(brief, 'status', 'Disabled');
      await review(page, brief, 'Automation summary', [
        'Current editor draft only. Publishing still requires validation and an explicit save.',
        'Optional checks that must pass before actions run.',
        'Actions are executed in order.',
      ]);
      await expect(page.getByLabel('Name', { exact: true })).toHaveValue('Unsaved source regression draft');
      await expect(page.getByRole('combobox', { name: 'Trigger type', exact: true })).toHaveValue('trigger_geofence');
      await expect(enabled).not.toBeChecked();
      await finish(page, mocks, diagnostics);
    });

    test(`private benchmark operands keep epsilon, efficiency and bounded estimates ${width}px ${theme}`, async ({ page }) => {
      const { mocks, diagnostics } = await openContract(page, '/benchmarks/privacy?vehicle_id=7', width, theme);
      const budget = page.getByRole('region', { name: 'Privacy budget', exact: true });
      const comparison = page.getByRole('region', { name: 'Private comparisons', exact: true });
      await expect(budget).toContainText('Participation active');
      await metric(budget, 'epsilon-spent', 'ε 0.50');
      await metric(budget, 'epsilon-budget', 'ε 10.00');
      await metric(budget, 'epsilon-remaining', 'ε 9.50');
      await metric(comparison, 'degradation_pct', '0.00%');
      await metric(comparison, 'efficiency_wh_per_km', '180.00 Wh/km');
      await metric(comparison, 'charging_reliability_pct', '95.00%');
      await metric(comparison, 'operation_reliability_pct', '—', 'missing');
      await expect(comparison).toContainText('Private release');
      await expect(comparison).toContainText('2026-08-01–2026-08-26; model 3; model-year bucket 2020–2024; k ≥ 5.');
      await expect(comparison).toContainText('Private IQR');
      await expect(comparison).toContainText('60.00th performance percentile');
      await expect(page.getByRole('progressbar', { name: 'Differential privacy budget used', exact: true })).toBeVisible();
      await expect(page.getByRole('table', { name: 'Cohort eligibility', exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Check current source version', exact: true })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Methodology & limits', exact: true })).toBeVisible();
      await review(page, budget, 'Privacy budget', [
        'Differential privacy epsilon allowance, not a confidence percentage.',
        'Privacy accounting; mechanism version 2; release threshold k ≥ 5.',
        'ε 0.50',
      ]);
      await review(page, comparison, 'Private comparisons', [
        'Release 901; mechanism version 2.',
        'Noisy cohort size: 12.00; noise scale: 0.50. These are private estimates, not confidence scores.',
        'Lower source values mean better performance.',
        'Higher source values mean better performance.',
        'It does not make a tiny local fleet representative, comparable, or suitable for causal conclusions.',
        '180.00 Wh/km',
      ]);
      await page.getByRole('button', { name: 'Revoke & delete contribution data', exact: true }).click();
      const confirmation = page.getByRole('dialog', { name: 'Revoke private benchmarks?', exact: true });
      await expect(confirmation).toBeVisible();
      await expect(confirmation.getByRole('button', { name: 'Revoke & delete', exact: true })).toBeDisabled();
      await confirmation.getByLabel('Type REVOKE to confirm', { exact: true }).fill('REVOKE');
      await expect(confirmation.getByRole('button', { name: 'Revoke & delete', exact: true })).toBeEnabled();
      await expectDialogsInsideViewport(page);
      await confirmation.getByRole('button', { name: 'Keep participation', exact: true }).click();
      await expect(confirmation).toHaveCount(0);
      await metric(budget, 'epsilon-spent', 'ε 0.50');
      await finish(page, mocks, diagnostics);
    });
  }
}

test('unknown inbox summary does not turn into six measured zeros or healthy coverage', async ({ page }) => {
  const state = actionsFixtureState();
  state.actionCenter.summary = null;
  state.actionCenter.provider_status = [{
    source_feature: 'charging_reliability', status: 'unavailable', item_count: 0,
    limitations: ['Source unavailable; no finding count can be inferred.'],
  }];
  const { mocks, diagnostics } = await openContract(page, '/action-center?vehicle_id=7', 320, 'light', state);
  const brief = page.getByRole('region', { name: 'Decision queue overview', exact: true });
  await expect(brief).toContainText('Summary unavailable');
  for (const key of ['open', 'critical', 'high', 'acknowledged', 'snoozed', 'dismissed']) await metric(brief, key, '—', 'missing');
  await expect(page.getByRole('article').filter({ hasText: 'Review interrupted charging evidence' })).toBeVisible();
  await expect(page.getByText('Source unavailable; no finding count can be inferred.', { exact: true })).toBeVisible();
  await review(page, brief, 'Decision queue overview', ['Provider-specific evidence windows and limits apply; these counts are not an all-time total.']);
  await finish(page, mocks, diagnostics);
});

test('degraded inbox providers preserve measured zero while exposing incomplete source scope', async ({ page }) => {
  const state = actionsFixtureState();
  state.actionCenter.provider_status[0].status = 'degraded';
  const { mocks, diagnostics } = await openContract(page, '/action-center?vehicle_id=7', 1440, 'dark', state);
  const brief = page.getByRole('region', { name: 'Decision queue overview', exact: true });
  await expect(brief).toContainText('Partial source coverage');
  await metric(brief, 'critical', '0');
  await review(page, brief, 'Decision queue overview', ['Source coverage is incomplete or unknown; unavailable sources do not imply zero findings.']);
  await finish(page, mocks, diagnostics);
});

test('malformed server counts are invalid rather than measured, rounded or clamped zeros', async ({ page }) => {
  const state = actionsFixtureState();
  if (!state.actionCenter.summary) throw new Error('The populated fixture requires a summary');
  state.actionCenter.summary.critical = -1;
  state.actionCenter.summary.high = 1.5;
  const { mocks, diagnostics } = await openContract(page, '/action-center?vehicle_id=7', 320, 'light', state);
  const brief = page.getByRole('region', { name: 'Decision queue overview', exact: true });
  await metric(brief, 'critical', '—', 'invalid');
  await metric(brief, 'high', '—', 'invalid');
  await metric(brief, 'open', '7');
  await review(page, brief, 'Decision queue overview', ['Expected a non-negative safe integer count']);
  await finish(page, mocks, diagnostics);
});

test('successful empty rule inventory is measured zero with filters and creation retained', async ({ page }) => {
  const state = actionsFixtureState();
  state.rules = [];
  const { mocks, diagnostics } = await openContract(page, '/automations?vehicle_id=7', 320, 'dark', state);
  const brief = page.getByTestId('automations-brief');
  await expect(brief).toContainText('Rules loaded');
  for (const key of ['total', 'active', 'disabled', 'autoDisabled']) await metric(brief, key, '0');
  await expect(page.getByRole('textbox', { name: 'Search automations...', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create', exact: true })).toBeVisible();
  await review(page, brief, 'Rule inventory', ['Full loaded rule set, before status and search filters.']);
  await finish(page, mocks, diagnostics);
});

for (const noRuns of [true, false]) {
  test(`execution ${noRuns ? 'zero denominator is unknown' : 'positive denominator retains zero rate and duration'}`, async ({ page }) => {
    const state = actionsFixtureState();
    if (noRuns) state.history = structuredClone(NO_RUNS);
    else {
      state.history.summary = { total_executions: 40, succeeded: 0, failed: 40, partial: 0, success_rate: 0, avg_duration_ms: 0 };
      state.history.trend = [{ day: '2026-08-25', status: 'failed', count: 40 }];
      state.history.items = state.history.items.map((row) => ({
        ...row, status: 'failed' as const, duration_ms: 0, actions_succeeded: 0,
        actions_failed: 1, error: 'Synthetic immediate failure',
        completed_at: row.triggered_at,
      }));
    }
    const { mocks, diagnostics } = await openContract(page, HISTORY_ROUTE, 320, 'light', state);
    const brief = page.getByTestId('automation-history-brief');
    await metric(brief, 'total', noRuns ? '0' : '40');
    await metric(brief, 'rate', noRuns ? '—' : '0.00%', noRuns ? 'missing' : 'value');
    await metric(brief, 'duration', noRuns ? '—' : '0.00ms', noRuns ? 'missing' : 'value');
    if (noRuns) {
      await expect(brief).toContainText('No completed runs in this summary; a rate and average duration are undefined.');
      await expect(page.getByRole('link', { name: 'Manage automation rules', exact: true })).toHaveAttribute('href', '/automations/list');
    }
    await review(page, brief, 'Execution summary', ['Server summary across the selected period and rule/status filters, not just this page of rows.']);
    await finish(page, mocks, diagnostics);
  });
}

test('consent-gated benchmark release is unknown, while successful inactive epsilon remains measured', async ({ page }) => {
  const state = actionsFixtureState();
  state.privacy.opted_in = false;
  state.privacy.epsilon_spent = 0;
  state.privacy.epsilon_remaining = 10;
  state.releases.items = [];
  const { mocks, diagnostics } = await openContract(page, '/benchmarks/privacy?vehicle_id=7', 320, 'dark', state);
  const comparison = page.getByRole('region', { name: 'Private comparisons', exact: true });
  await expect(comparison).toContainText('Consent required');
  for (const key of ['degradation_pct', 'efficiency_wh_per_km', 'charging_reliability_pct', 'operation_reliability_pct']) await metric(comparison, key, '—', 'missing');
  await metric(page.getByRole('region', { name: 'Privacy budget', exact: true }), 'epsilon-spent', 'ε 0.00');
  const acknowledge = page.getByRole('checkbox', { name: 'I opt in to bounded aggregate benchmarking and understand that released aggregates cannot be withdrawn.', exact: true });
  await expect(acknowledge).toBeVisible();
  await expect(page.getByRole('button', { name: 'Opt in', exact: true })).toBeDisabled();
  await acknowledge.check();
  await expect(page.getByRole('button', { name: 'Opt in', exact: true })).toBeEnabled();
  await review(page, comparison, 'Private comparisons', ['No released cohort or source window is available.']);
  expect([...mocks.seen].some((request) => request.startsWith('GET /benchmarks/releases?'))).toBe(false);
  await finish(page, mocks, diagnostics);
});

test('active participation without a stable release retains the create form without fabricated comparisons', async ({ page }) => {
  const state = actionsFixtureState();
  state.releases.items = [];
  state.privacy.epsilon_spent = 0;
  state.privacy.epsilon_remaining = 10;
  const { mocks, diagnostics } = await openContract(page, '/benchmarks/privacy?vehicle_id=7', 1440, 'light', state);
  const comparison = page.getByRole('region', { name: 'Private comparisons', exact: true });
  await expect(comparison).toContainText('No stable release yet');
  for (const key of ['degradation_pct', 'efficiency_wh_per_km', 'charging_reliability_pct', 'operation_reliability_pct']) await metric(comparison, key, '—', 'missing');
  await expect(page.getByRole('button', { name: 'Create release', exact: true })).toBeVisible();
  await metric(page.getByRole('region', { name: 'Privacy budget', exact: true }), 'epsilon-spent', 'ε 0.00');
  await review(page, comparison, 'Private comparisons', ['No released cohort or source window is available.']);
  await finish(page, mocks, diagnostics);
});

test('suppressed private release remains suppressed, not an exact fleet ranking or confidence score', async ({ page }) => {
  const state = actionsFixtureState();
  const release = state.releases.items[0];
  release.suppressed = true;
  release.suppression_reason = 'insufficient_cohort';
  for (const item of release.metrics) {
    item.suppressed = true;
    item.quality = 'suppressed';
    item.target_value = null;
    item.percentile = null;
    item.noisy_cohort_size = null;
    item.noisy_p25 = null;
    item.noisy_p75 = null;
    item.noise_scale = null;
  }
  const { mocks, diagnostics } = await openContract(page, '/benchmarks/privacy?vehicle_id=7', 320, 'dark', state);
  const comparison = page.getByRole('region', { name: 'Private comparisons', exact: true });
  await expect(comparison).toContainText('Release suppressed');
  for (const key of ['degradation_pct', 'efficiency_wh_per_km', 'charging_reliability_pct', 'operation_reliability_pct']) await metric(comparison, key, '—', 'missing');
  await review(page, comparison, 'Private comparisons', [
    'Suppressed below privacy threshold',
    'Percentile unavailable',
    'Noisy cohort size: —; noise scale: —. These are private estimates, not confidence scores.',
    'Release 901; mechanism version 2.',
  ]);
  await finish(page, mocks, diagnostics);
});

test('actual evidence refresh retains publication instead of replacing it with zeros', async ({ page }) => {
  test.setTimeout(60_000);
  const { mocks, diagnostics, state } = await openContract(page, '/action-center?vehicle_id=7', 320, 'dark');
  const brief = page.getByRole('region', { name: 'Decision queue overview', exact: true });
  await metric(brief, 'open', '7');
  const before = await brief.locator('[data-operational-value]').allTextContents();
  state.failActionRefresh = true;
  await page.getByRole('button', { name: 'Refresh evidence', exact: true }).click();
  await expect(brief).toContainText('Retained summary', { timeout: 30_000 });
  expect(await brief.locator('[data-operational-value]').allTextContents()).toEqual(before);
  await expect(page.getByRole('article').filter({ hasText: 'Review interrupted charging evidence' })).toBeVisible();
  await review(page, brief, 'Decision queue overview', ['Server-generated recommendation evidence']);
  expect(diagnostics.pageErrors).toEqual([]);
  expect(diagnostics.brokenResources).toEqual([]);
  expect(diagnostics.failedDataRequests.length).toBeGreaterThan(0);
  for (const failure of diagnostics.failedDataRequests) expect(failure).toMatch(/^503 (?:xhr|fetch) .*\/api\/v1\/action-center(?:\?|$)/);
  for (const error of diagnostics.consoleErrors) {
    expect(error).toMatch(/^Failed to load resource: the server responded with a status of 503 \((?:Service Unavailable)?\)$/);
  }
  state.failActionRefresh = false;
  await page.getByRole('button', { name: 'Refresh evidence', exact: true }).click();
  await expect(brief).toContainText('Summary returned');
  expect(await brief.locator('[data-operational-value]').allTextContents()).toEqual(before);
  await expectNoHorizontalOverflow(page);
  expect(mocks.requests.filter((request) => DOMAIN_PATHS.test(request.path) && request.method !== 'GET')).toEqual([]);
  await assertMockApiComplete(page, mocks);
});
