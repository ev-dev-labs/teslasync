import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  assertMockApiComplete, expectThemeApplied, fulfillApiFixture, installApiMocks,
  seedBrowserState, waitForHarnessReady, type MockApiController,
} from '../mockApi';
import {
  expectDialogsInsideViewport, expectNoHorizontalOverflow,
  expectNoRuntimeFailures, monitorPage,
} from '../qualityAssertions';
import {
  federated, insufficientRound, observation, quality, simulations, storm, stormEvents,
  survival, zeroFederated, type MetricExpectation, type SimulationCase,
} from './advanced-intelligence.fixtures';
import type { AdvancedPage, ComponentSurvival, JourneyAssuranceRequest } from '../../src/types/advancedIntelligence';

test.beforeEach(() => {
  expect(process.env.E2E_MOCKS, 'These source-contract tests require the strict synthetic API harness').not.toBe('0');
});
test.use({ timezoneId: 'UTC', locale: 'en-US', reducedMotion: 'reduce' });

async function assertMetrics(brief: Locator, metrics: readonly MetricExpectation[]) {
  await expect(brief.locator('[data-operational-metric]')).toHaveCount(metrics.length);
  for (const metric of metrics) {
    const row = brief.locator(`[data-operational-metric="${metric.key}"]`);
    await expect(row).toHaveAttribute('data-value-state', metric.state);
    await expect(row.locator('[data-operational-value]')).toHaveText(metric.text);
  }
}

async function stormSources(page: Page, mocks: MockApiController | null) {
  await page.route('**/api/v1/stormguard/status?*', async route => {
    expect(route.request().method()).toBe('GET');
    expect(new URL(route.request().url()).search).toBe('?vehicle_id=7');
    await fulfillApiFixture(route, mocks, { json: storm });
  });
  await page.route('**/api/v1/stormguard/events?*', async route => {
    expect(route.request().method()).toBe('GET');
    expect(new URL(route.request().url()).search).toBe('?vehicle_id=7&limit=10');
    await fulfillApiFixture(route, mocks, { json: stormEvents });
  });
}

async function reviewSource(page: Page, brief: Locator, title: string, source: string, limitations: readonly string[]) {
  await expect(brief).toHaveAttribute('data-operational-brief', '');
  await expect(brief).toContainText('Vehicle #7');
  await expect(brief).toContainText('Observation window: Aug 1, 2026');
  await expect(brief).toContainText('Aug 3, 2026');
  await expect(brief).toContainText('Result generated: Aug 3, 2026');
  await expect(brief).toContainText(source);
  const review = brief.getByRole('button', { name: 'Review details', exact: true });
  await review.focus();
  await page.keyboard.press('Enter');
  const drawer = page.getByRole('dialog', { name: `${title} details`, exact: true });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByTestId('operational-narrative')).toContainText('Not scored');
  await expect(drawer).toContainText('Source quality sample count: 0');
  await expect(drawer).toContainText('Source coverage not supplied');
  await expect(drawer).toContainText(quality.reasons[0]);
  await expect(drawer).toContainText(`${observation.summary} · 0 samples`);
  await expect(drawer).toContainText(observation.source);
  await expect(drawer).toContainText('Aug 2, 2026');
  await expect(drawer).toContainText(source);
  for (const limitation of limitations) await expect(drawer).toContainText(limitation);
  // Released AnalysisBrief has no metric/context/provenance hrefs. Do not invent navigation.
  await expect(brief.getByRole('link')).toHaveCount(0);
  await expect(drawer.getByRole('link')).toHaveCount(0);
  await expectDialogsInsideViewport(page);
  await expectNoHorizontalOverflow(page);
  await page.keyboard.press('Tab');
  expect(await drawer.evaluate(node => node.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(drawer).not.toBeVisible();
  await expect(review).toBeFocused();
}

async function simulationMock(page: Page, mocks: MockApiController | null, subject: SimulationCase,
  response: SimulationCase['variants'][number]['response']) {
  let calls = 0;
  await page.route(`**/api/v1${subject.endpoint}`, async route => {
    expect(route.request().method()).toBe('POST');
    expect(new URL(route.request().url()).search).toBe('');
    const body: unknown = route.request().postDataJSON();
    if (subject.name === 'journey') {
      const request = body as JourneyAssuranceRequest;
      expect(request).toEqual({ ...subject.request, departure_at: request.departure_at });
      expect(Number.isFinite(Date.parse(request.departure_at))).toBe(true);
      expect(request.departure_at).toMatch(/Z$/);
    } else {
      expect(body).toEqual(subject.request);
    }
    calls += 1;
    await fulfillApiFixture(route, mocks, { json: response });
  });
  return () => calls;
}

for (const theme of ['light', 'dark'] as const) {
  for (const width of [320, 1440]) {
    for (const subject of simulations) {
      for (const variant of subject.variants) {
        test(`${subject.name} ${variant.name}: real brief, source drawer and controls at ${width}px ${theme}`, async ({ page }) => {
          const diagnostics = monitorPage(page);
          await page.setViewportSize({ width, height: 1000 });
          await seedBrowserState(page, theme, subject.route);
          const mocks = await installApiMocks(page, 'populated', theme);
          expect(mocks).not.toBeNull();
          if (subject.name === 'resilience') await stormSources(page, mocks);
          const calls = await simulationMock(page, mocks, subject, variant.response);
          await page.goto(subject.route);
          await waitForHarnessReady(page, mocks);
          const brief = page.getByTestId(subject.briefId);
          await expect(brief).toBeVisible();
          await expect(brief).toContainText('Not calculated');
          await expect(brief).toContainText('Observation window not supplied');
          await expect(brief).toContainText('Result generation time not supplied');
          await expect(brief.locator('[data-operational-metric][data-value-state="missing"]'))
            .toHaveCount(variant.metrics.length);
          expect(calls()).toBe(0);
          const run = page.getByRole('button', { name: subject.button, exact: true });
          await expect(run).toBeEnabled();
          await run.click();
          await expect.poll(calls).toBe(1);
          await waitForHarnessReady(page, mocks);
          await assertMetrics(brief, variant.metrics);
          await expect(brief).toContainText('Limited evidence');
          await reviewSource(page, brief, subject.title, subject.source,
            subject.name === 'site'
              ? [...variant.response.limitations, ...('assumptions' in variant.response ? variant.response.assumptions : [])]
              : variant.response.limitations);
          await expect(run).toBeEnabled();
          if (subject.name === 'journey') {
            await expect(brief.locator('[data-operational-metric="readiness"]'))
              .toContainText('not a vehicle health assessment or confidence estimate');
            await expect(page.getByText('Observed charge, not readiness proof.', { exact: true })).toBeVisible();
            await expect(page.getByText('Unknown weather is not zero degrees.', { exact: true })).toBeVisible();
          }
          if (subject.name === 'twin') {
            await expect(brief.locator('[data-operational-metric="calibration-samples"]'))
              .toContainText('not scenario count or confidence');
            await expect(page.getByRole('button', { name: 'Add scenario', exact: true })).toBeEnabled();
            await expect(page.getByLabel(/Scenario name/)).toHaveCount(2);
          }
          if (subject.name === 'site') {
            await expect(page.getByText('Caller order first', { exact: true })).toBeVisible();
            await expect(page.getByText('Caller order second', { exact: true })).toBeVisible();
          }
          if (subject.name === 'resilience') {
            await expect(page.getByText(storm.assessment.reason, { exact: true })).toBeVisible();
            await expect(page.getByText('Caller priority first', { exact: true })).toBeVisible();
            await expect(page.getByText('Caller priority second', { exact: true })).toBeVisible();
          }
          await expectThemeApplied(page, theme);
          await expectNoHorizontalOverflow(page);
          expect([...mocks!.seen]).toContain(`POST ${subject.endpoint}`);
          await assertMockApiComplete(page, mocks);
          await expectNoRuntimeFailures(diagnostics);
        });
      }
    }

    for (const [state, response, expected] of [
      ['spent-budget', federated, ['2.00', '1.50', '0.50']],
      ['zero-budget', zeroFederated, ['0.00', '0.00', '0.00']],
    ] as const) {
      test(`federated ${state}: epsilon is neither percent nor loaded-card count at ${width}px ${theme}`, async ({ page }) => {
        const diagnostics = monitorPage(page);
        const routePath = '/intelligence/federated-learning';
        await page.setViewportSize({ width, height: 1000 });
        await seedBrowserState(page, theme, routePath);
        const mocks = await installApiMocks(page, 'populated', theme);
        expect(mocks).not.toBeNull();
        await page.route('**/api/v1/advanced-intelligence/federated-learning/model-cards?*', async route => {
          expect(route.request().method()).toBe('GET');
          expect(new URL(route.request().url()).search).toBe('?vehicle_id=7&limit=12&offset=0');
          await fulfillApiFixture(route, mocks, { json: response });
        });
        await page.goto(routePath);
        await waitForHarnessReady(page, mocks);
        const brief = page.getByTestId('advanced-intelligence-federated-brief');
        await assertMetrics(brief, ['epsilon-budget', 'epsilon-spent', 'epsilon-remaining']
          .map((key, index) => ({ key, text: expected[index], state: 'value' })));
        await expect(brief).toContainText('dimensionless epsilon, not a percentage');
        await reviewSource(page, brief, 'Subject privacy budget', 'Local subject privacy accounting',
          response.items.flatMap(card => card.limitations));
        await page.getByRole('button', { name: 'Use for next local round', exact: true }).click();
        await expect(page.getByLabel(/^Model name/)).toHaveValue(response.items[0].model_name);
        await expect(page.getByLabel(/^Model version/)).toHaveValue(response.items[0].model_version);
        await expect(page.getByLabel(/^Expected model-card version/)).toHaveValue(String(response.items[0].version));
        await page.getByRole('button', { name: 'Review privacy spend', exact: true }).click();
        const confirmation = page.getByRole('dialog', { name: 'Confirm local privacy spend', exact: true });
        await expect(confirmation).toContainText('It never uploads raw vehicle data.');
        await expectDialogsInsideViewport(page);
        await confirmation.getByRole('button', { name: 'Cancel', exact: true }).click();
        await expect(confirmation).not.toBeVisible();
        expect([...mocks!.seen].filter(key => key.startsWith('POST /advanced-intelligence/'))).toEqual([]);
        await expectThemeApplied(page, theme);
        await expectNoHorizontalOverflow(page);
        await assertMockApiComplete(page, mocks);
        await expectNoRuntimeFailures(diagnostics);
      });
    }

    for (const [width, theme] of [[320, 'light'], [1440, 'dark']] as const) {
      for (const subject of simulations) {
        test(`${subject.name} keeps its published result during a second real calculation at ${width}px ${theme}`, async ({ page }) => {
          const diagnostics = monitorPage(page);
          const variant = subject.variants[1];
          let calls = 0;
          let release!: () => void;
          const recalculation = new Promise<void>(resolve => { release = resolve; });
          await page.setViewportSize({ width, height: 1000 });
          await seedBrowserState(page, theme, subject.route);
          const mocks = await installApiMocks(page, 'populated', theme);
          expect(mocks).not.toBeNull();
          if (subject.name === 'resilience') await stormSources(page, mocks);
          await page.route(`**/api/v1${subject.endpoint}`, async route => {
            expect(route.request().method()).toBe('POST');
            expect(route.request().postDataJSON()).toMatchObject(subject.request);
            calls += 1;
            if (calls === 2) await recalculation;
            await fulfillApiFixture(route, mocks, { json: variant.response });
          });
          await page.goto(subject.route);
          await waitForHarnessReady(page, mocks);
          const brief = page.getByTestId(subject.briefId);
          const run = page.getByRole('button', { name: subject.button, exact: true });
          await run.click();
          await expect.poll(() => calls).toBe(1);
          await waitForHarnessReady(page, mocks);
          await assertMetrics(brief, variant.metrics);
          await run.click();
          await expect.poll(() => calls).toBe(2);
          try {
            await expect(run).toBeDisabled();
            await expect(brief).toContainText('Updating result');
            await assertMetrics(brief, variant.metrics);
            await reviewSource(page, brief, subject.title, subject.source, variant.response.limitations);
          } finally {
            // Drain only the held response; assertion failures are never swallowed.
            release();
          }
          await waitForHarnessReady(page, mocks);
          await assertMetrics(brief, variant.metrics);
          await expect(run).toBeEnabled();
          await expectNoHorizontalOverflow(page);
          await assertMockApiComplete(page, mocks);
          await expectNoRuntimeFailures(diagnostics);
        });
      }

      test(`federated retains the published budget through real round invalidation and Retry at ${width}px ${theme}`, async ({ page }) => {
        const diagnostics = monitorPage(page);
        const routePath = '/intelligence/federated-learning';
        const endpoint = '/api/v1/advanced-intelligence/federated-learning/model-cards';
        let phase: 'initial' | 'failed-refresh' | 'recovery' = 'initial';
        let rounds = 0;
        await page.setViewportSize({ width, height: 1000 });
        await seedBrowserState(page, theme, routePath);
        const mocks = await installApiMocks(page, 'populated', theme);
        expect(mocks).not.toBeNull();
        await page.route(`**${endpoint}?*`, async route => {
          expect(route.request().method()).toBe('GET');
          expect(new URL(route.request().url()).search).toBe('?vehicle_id=7&limit=12&offset=0');
          await fulfillApiFixture(route, mocks, phase === 'failed-refresh'
            ? { status: 422, json: { error: 'Synthetic model-card refresh unavailable' } }
            : { json: federated });
        });
        await page.route('**/api/v1/advanced-intelligence/federated-learning/rounds', async route => {
          expect(route.request().method()).toBe('POST');
          expect(route.request().postDataJSON()).toEqual({
            vehicle_id: 7, model_name: federated.items[0].model_name,
            model_version: federated.items[0].model_version, task: federated.items[0].task,
            epsilon: 0.1, epsilon_budget: 2, expected_version: 8, confirmed: true,
          });
          rounds += 1;
          phase = 'failed-refresh';
          await fulfillApiFixture(route, mocks, { json: insufficientRound });
        });
        await page.goto(routePath);
        await waitForHarnessReady(page, mocks);
        const brief = page.getByTestId('advanced-intelligence-federated-brief');
        const metrics: readonly MetricExpectation[] = [
          { key: 'epsilon-budget', text: '2.00', state: 'value' },
          { key: 'epsilon-spent', text: '1.50', state: 'value' },
          { key: 'epsilon-remaining', text: '0.50', state: 'value' },
        ];
        await assertMetrics(brief, metrics);
        await page.getByRole('button', { name: 'Use for next local round', exact: true }).click();
        await page.getByRole('button', { name: 'Review privacy spend', exact: true }).click();
        const confirmation = page.getByRole('dialog', { name: 'Confirm local privacy spend', exact: true });
        await expect(confirmation).toContainText('0.1 epsilon');
        expect(rounds).toBe(0);
        await confirmation.getByRole('button', { name: 'Start local round', exact: true }).click();
        await expect.poll(() => rounds).toBe(1);
        await expect(confirmation).not.toBeVisible();
        await expect(brief).toContainText('Retained result', { timeout: 20000 });
        await assertMetrics(brief, metrics);
        await reviewSource(page, brief, 'Subject privacy budget', 'Local subject privacy accounting',
          federated.items.flatMap(card => card.limitations));
        await expect(page.getByText('Previously loaded data remains visible while affected sources recover.', { exact: true }).first()).toBeVisible();
        phase = 'recovery';
        await page.getByRole('button', { name: 'Retry', exact: true }).first().click();
        await expect(brief).toContainText('Limited evidence');
        await waitForHarnessReady(page, mocks);
        await assertMetrics(brief, metrics);
        expect(rounds).toBe(1);
        await expectThemeApplied(page, theme);
        await expectNoHorizontalOverflow(page);
        await assertMockApiComplete(page, mocks);
        // This scenario intentionally returns 422; require those failures to be only the exact refresh source.
        expect(diagnostics.failedDataRequests.length).toBeGreaterThan(0);
        expect(diagnostics.failedDataRequests.every(message => message.startsWith('422 ')
          && new URL(message.slice(message.indexOf('http'))).pathname === endpoint)).toBe(true);
        expect(diagnostics.pageErrors).toEqual([]);
        expect(diagnostics.brokenResources).toEqual([]);
        expect(diagnostics.consoleErrors.every(message =>
          /^Failed to load resource: the server responded with a status of 422\b/.test(message))).toBe(true);
      });
    }

    test(`component probability remains per-entity, not a new summary score at ${width}px ${theme}`, async ({ page }) => {
      const diagnostics = monitorPage(page);
      const path = '/intelligence/component-survival';
      const response = {
        items: [
          survival,
          { ...survival, component: 'front-bearing-zero', survival_probability_pct: 0 },
          { ...survival, component: 'front-bearing-supported', survival_probability_pct: 72.5 },
        ],
        total: 3, limit: 12, offset: 0,
      } satisfies AdvancedPage<ComponentSurvival>;
      await page.setViewportSize({ width, height: 1000 });
      await seedBrowserState(page, theme, path);
      const mocks = await installApiMocks(page, 'populated', theme);
      expect(mocks).not.toBeNull();
      await page.route('**/api/v1/advanced-intelligence/component-survival?*', async route => {
        expect(route.request().method()).toBe('GET');
        expect(new URL(route.request().url()).search).toBe('?vehicle_id=7&limit=12&offset=0');
        await fulfillApiFixture(route, mocks, { json: response });
      });
      await page.goto(path);
      await waitForHarnessReady(page, mocks);
      await expect(page.locator('main [data-operational-brief]')).toHaveCount(0);
      const unknown = page.locator('article').filter({ has: page.getByRole('heading', { name: 'front-bearing', exact: true }) });
      const zero = page.locator('article').filter({ has: page.getByRole('heading', { name: 'front-bearing-zero', exact: true }) });
      const supported = page.locator('article').filter({ has: page.getByRole('heading', { name: 'front-bearing-supported', exact: true }) });
      const probabilityCard = (article: Locator) => article.getByText('Survival probability', { exact: true }).locator('xpath=../..');
      await expect(probabilityCard(unknown).getByText('—', { exact: true })).toBeVisible();
      await expect(probabilityCard(zero).getByText('0.00%', { exact: true })).toBeVisible();
      await expect(probabilityCard(supported).getByText('72.50%', { exact: true })).toBeVisible();
      await expect(zero).toContainText('observed-wear · 0 evidence');
      await expect(zero).toContainText('unmeasured-corrosion · 0 evidence');
      await expect(zero).toContainText('Unsupported');
      await expectThemeApplied(page, theme);
      await expectNoHorizontalOverflow(page);
      await assertMockApiComplete(page, mocks);
      await expectNoRuntimeFailures(diagnostics);
    });
  }
}
