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
} from '../qualityAssertions';
import {
  BUNDLED_ENVELOPES,
  DRAFT_EXPECTATION,
  failLocalTrustReads,
  INSTALLED_GRANT,
  localTrustReadAttempts,
  MARKETPLACE_PATH,
  SANDBOX_BRIEF_ID,
  SIMULATED_GRANT,
  STARTER_EXPECTATION,
  restoreLocalTrustReads,
  type SandboxExpectation,
} from './intelligence-packs.fixtures';

type Theme = 'light' | 'dark';

function card(page: Page, title: string, occurrence = 0): Locator {
  const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return page.locator('[data-card-title]')
    .filter({ hasText: new RegExp(`^${escaped}$`) })
    .nth(occurrence)
    .locator('xpath=ancestor::*[@data-card][1]');
}

async function openMarketplace(page: Page, width: number, theme: Theme): Promise<MockApiController> {
  expect(ROUTE_REGISTRY.find(entry => entry.path === MARKETPLACE_PATH)?.name)
    .toBe('IntelligencePackMarketplace');
  await page.setViewportSize({ width, height: 1000 });
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: theme });
  await seedBrowserState(page, theme, MARKETPLACE_PATH);
  const api = await installApiMocks(page, 'populated', theme);
  if (!api) throw new Error('Intelligence-pack source contracts require the strict mocked API harness');
  await page.goto(MARKETPLACE_PATH, { waitUntil: 'domcontentloaded' });
  await waitForHarnessReady(page, api);
  await expectThemeApplied(page, theme);
  await expect(page.getByRole('heading', { level: 1, name: 'Intelligence-pack marketplace' })).toBeVisible();
  await expect(page.getByRole('tablist', { name: 'Intelligence-pack marketplace sections', exact: true })
    .getByRole('tab')).toHaveText([
    'Catalog', 'Installed', 'Sandbox preview', 'Audit log', 'Import / export', 'Security & methodology',
  ]);
  return api;
}

async function selectTab(page: Page, name: string): Promise<void> {
  const tab = page.getByRole('tablist', { name: 'Intelligence-pack marketplace sections', exact: true })
    .getByRole('tab', { name, exact: true });
  await tab.click();
  await expect(tab).toHaveAttribute('aria-selected', 'true');
}

async function expectCharts(page: Page, fixture: SandboxExpectation): Promise<void> {
  for (const chart of fixture.charts) {
    const table = page.getByRole('table', { name: `${chart.title} — data table`, exact: true });
    await expect(table.getByRole('columnheader')).toHaveText(['Sample', `Value (${chart.unit})`]);
    const rows = table.getByRole('row').filter({ has: page.getByRole('cell') });
    await expect(rows).toHaveCount(chart.values.length);
    for (let index = 0; index < chart.values.length; index += 1) {
      await expect(rows.nth(index).getByRole('cell')).toHaveText([String(index), String(chart.values[index])]);
    }
  }
}

async function expectRun(page: Page, fixture: SandboxExpectation): Promise<string> {
  const brief = page.getByTestId(SANDBOX_BRIEF_ID);
  await expect(brief).toHaveAttribute('data-operational-brief', 'true');
  await expect(brief).toContainText('Synthetic sandbox');
  await expect(brief).toContainText('Sample evaluation complete');
  await expect(brief).toContainText(`${fixture.envelope.manifest.name} · v${fixture.envelope.manifest.version}`);
  await expect(brief).toContainText('Selected run; no vehicle-data timestamp');
  await expect(brief).toContainText('not a subscription or evidence of model accuracy on real vehicle data');
  await expect(brief.locator('[data-operational-metric]')).toHaveCount(3);
  for (const [id, value] of [
    ['sandbox-sample-rows', String(fixture.rows)],
    ['sandbox-evaluation-steps', String(fixture.steps)],
  ]) {
    const metric = brief.locator(`[data-operational-metric="${id}"]`);
    await expect(metric).toHaveAttribute('data-value-state', 'value');
    await expect(metric.locator('[data-operational-value]')).toHaveText(value);
  }
  const elapsed = brief.locator('[data-operational-metric="sandbox-elapsed-time"]');
  await expect(elapsed).toHaveAttribute('data-value-state', 'value');
  await expect(elapsed.locator('[data-operational-value]')).toHaveText(/^\d+\s?ms$/);
  const display = (await elapsed.locator('[data-operational-value]').innerText()).trim();
  const milliseconds = Number(display.replace(/\s?ms$/, ''));
  expect(Number.isFinite(milliseconds)).toBe(true);
  expect(milliseconds).toBeGreaterThanOrEqual(0);
  const runStats = `${fixture.rows} sample rows · ${fixture.steps} evaluation steps · ${milliseconds}ms`;
  await expect(brief.getByText(runStats, { exact: true })).toBeVisible();
  await expectCharts(page, fixture);
  return runStats;
}

async function reviewRun(
  page: Page,
  fixture: SandboxExpectation,
  grant: string,
  runStats: string,
): Promise<void> {
  const brief = page.getByTestId(SANDBOX_BRIEF_ID);
  const before = await brief.innerText();
  const tableBefore = await Promise.all(fixture.charts.map(chart =>
    page.getByRole('table', { name: `${chart.title} — data table`, exact: true }).innerText()));
  const review = brief.getByRole('button', { name: 'Review details', exact: true });
  await review.scrollIntoViewIfNeeded();
  await review.focus();
  await review.press('Enter');
  const drawer = page.getByRole('dialog', { name: 'Selected pack evaluation details', exact: true });
  await expect(drawer).toBeVisible();
  await expect(drawer).toHaveAttribute('aria-modal', 'true');
  const narrative = drawer.getByTestId('operational-narrative');
  await expect(narrative.getByText('Not scored', { exact: true })).toBeVisible();
  await expect(narrative.getByText('No confidence basis was supplied.', { exact: true })).toBeVisible();
  await expect(narrative).toContainText('Local bounded interpreter over bundled synthetic sample data; no network or real telemetry.');
  await expect(narrative).toContainText(grant);
  await expect(drawer.getByText(runStats, { exact: true })).toBeVisible();
  for (const detail of [
    'Bundled synthetic rows used by this evaluation, not recorded vehicle observations.',
    'Interpreter steps consumed by the selected pack, not a configured execution ceiling.',
    'Measured wall-clock time for this synthetic evaluation; this is not a live-data freshness timestamp.',
    'No current attention items.',
  ]) {
    await expect(drawer.getByText(detail, { exact: true })).toBeVisible();
  }
  const closeButtons = drawer.getByRole('button', { name: 'Close', exact: true });
  await expect(closeButtons).toHaveCount(2);
  await expect(closeButtons.first()).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(closeButtons.last()).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(closeButtons.first()).toBeFocused();
  await expectDialogsInsideViewport(page);
  await expectNoHorizontalOverflow(page);
  for (const selector of ['[data-drawer-panel]', '[data-drawer-body]']) {
    expect(await drawer.locator(selector).evaluate(node => node.scrollWidth <= node.clientWidth + 1),
      `${selector} must not horizontally clip metric details`).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);
  await expect(review).toBeFocused();
  expect(await brief.innerText()).toBe(before);
  expect(await Promise.all(fixture.charts.map(chart =>
    page.getByRole('table', { name: `${chart.title} — data table`, exact: true }).innerText()))).toEqual(tableBefore);
  await expect(page.getByRole('combobox', { name: 'Pack to preview', exact: true }))
    .toHaveValue(fixture.envelope.manifest.id);
}

async function complete(page: Page, api: MockApiController): Promise<void> {
  await expectNoHorizontalOverflow(page);
  await assertMockApiComplete(page, api);
  expect(api.requests.filter(request => /\/intelligence-packs(?:\/|\?|$)/.test(request.path)),
    'Pack evaluation/install/export are local operations, not invented API routes').toEqual([]);
}

for (const width of [320, 1440]) {
  for (const theme of ['light', 'dark'] as const) {
    test(`synthetic brief, signed/zero widgets and keyboard drawer survive ${width}px ${theme}`, async ({ page }) => {
      test.setTimeout(90_000);
      const diagnostics = monitorPage(page);
      const api = await openMarketplace(page, width, theme);
      await selectTab(page, 'Sandbox preview');
      const selector = page.getByRole('combobox', { name: 'Pack to preview', exact: true });
      await expect(selector.getByRole('option')).toHaveText(
        BUNDLED_ENVELOPES.map(envelope => `${envelope.manifest.name} (v${envelope.manifest.version})`));
      await expect(page.getByText(SIMULATED_GRANT, { exact: true })).toBeVisible();
      await expect(page.getByText(/Runs entirely offline against bundled synthetic sample data/)).toBeVisible();
      const starterStats = await expectRun(page, STARTER_EXPECTATION);
      await expect(card(page, 'Sandbox preview').locator('[data-card-content] [data-card-title]')).toHaveText(
        STARTER_EXPECTATION.envelope.manifest.dashboards.flatMap(dashboard => dashboard.widgets.map(widget => widget.title)));
      const flag = card(page, 'Currently Below Target');
      await expect(flag.getByText('0.00 flag', { exact: true })).toBeVisible();
      await expect(flag.getByText('avg 0.64 flag', { exact: true })).toBeVisible();
      await expect(flag.getByText('—', { exact: true })).toHaveCount(0);
      // A boolean formula is not a score; the observed-range widget is not confidence.
      await expect(flag.getByText('0.00%', { exact: true })).toHaveCount(0);
      const observedRange = card(page, 'Battery Headroom', 1);
      await expect(observedRange).toContainText('63.0');
      await expect(observedRange).toContainText('sample 21.00–69.00 %');
      await expect(observedRange.locator('[role="progressbar"]')).toHaveCount(0);
      await reviewRun(page, STARTER_EXPECTATION, SIMULATED_GRANT, starterStats);
      await selector.selectOption(DRAFT_EXPECTATION.envelope.manifest.id);
      const draftStats = await expectRun(page, DRAFT_EXPECTATION);
      await expect(card(page, 'Sandbox preview').locator('[data-card-content] [data-card-title]')).toHaveText(
        DRAFT_EXPECTATION.envelope.manifest.dashboards.flatMap(dashboard => dashboard.widgets.map(widget => widget.title)));
      await reviewRun(page, DRAFT_EXPECTATION, SIMULATED_GRANT, draftStats);
      await selector.selectOption(STARTER_EXPECTATION.envelope.manifest.id);
      await expectRun(page, STARTER_EXPECTATION);
      await complete(page, api);
      await expectNoRuntimeFailures(diagnostics);
    });

    test(`local grants, rich recommendations, export and safety actions survive ${width}px ${theme}`, async ({ page }) => {
      test.setTimeout(90_000);
      const diagnostics = monitorPage(page);
      const api = await openMarketplace(page, width, theme);
      const starter = STARTER_EXPECTATION.envelope;
      await card(page, starter.manifest.name).getByRole('button', { name: 'View & install', exact: true }).click();
      const detail = page.getByRole('dialog', { name: starter.manifest.name, exact: true });
      await expect(detail.getByRole('button', { name: 'Install', exact: true })).toBeEnabled();
      await expect(detail.getByText('4 analytics formulas', { exact: true })).toBeVisible();
      await expect(detail.getByText('2 bounded coefficients', { exact: true })).toBeVisible();
      await expect(detail.getByText('1 dashboard layouts', { exact: true })).toBeVisible();
      const recommendations = detail.getByRole('region', { name: 'Automation recommendations', exact: true });
      for (const recommendation of starter.manifest.automationRecommendations) {
        for (const text of [
          recommendation.title, recommendation.rationale, recommendation.suggestedTriggerSummary,
          recommendation.suggestedConditionSummary, recommendation.suggestedActionSummary,
        ]) {
          await expect(recommendations.getByText(text, { exact: true })).toBeVisible();
        }
      }
      await expect(recommendations.getByRole('button')).toHaveCount(0);
      await expectDialogsInsideViewport(page);
      await detail.getByRole('button', { name: 'Install', exact: true }).click();
      const confirmation = page.getByRole('dialog', { name: 'Install pack?', exact: true });
      await expect(confirmation).toContainText('key possession');
      for (const capability of starter.manifest.capabilities) await expect(confirmation).toContainText(capability);
      await confirmation.getByRole('button', { name: 'Install', exact: true }).click();
      await expect(confirmation).toHaveCount(0);
      await expect(card(page, starter.manifest.name).getByRole('button', { name: 'Up to date (v1.0.0)', exact: true })).toBeVisible();

      await selectTab(page, 'Installed');
      await page.getByRole('button', { name: 'Expand row', exact: true }).click();
      await expect(page.getByText('Capability grant on record', { exact: true })).toBeVisible();
      await expect(page.getByText('Trust decision: trusted-signed-recognized', { exact: true })).toBeVisible();
      await expect(page.getByText('0 previous version(s) retained for rollback', { exact: true })).toBeVisible();
      const enabled = page.getByRole('switch', { name: `Enable ${starter.manifest.name}`, exact: true });
      await expect(enabled).toBeChecked();
      await enabled.click();
      await expect(enabled).not.toBeChecked();
      await enabled.click();
      await expect(enabled).toBeChecked();

      await selectTab(page, 'Sandbox preview');
      await expect(page.getByText(INSTALLED_GRANT, { exact: true })).toBeVisible();
      const runStats = await expectRun(page, STARTER_EXPECTATION);
      await reviewRun(page, STARTER_EXPECTATION, INSTALLED_GRANT, runStats);
      const retainedBrief = await page.getByTestId(SANDBOX_BRIEF_ID).innerText();
      await failLocalTrustReads(page);
      try {
        // ReloadPrompt's real online lifecycle handler invalidates active
        // queries; the fault changes only the exact local trust-table read.
        await page.evaluate(() => window.dispatchEvent(new Event('online')));
        await expect.poll(() => localTrustReadAttempts(page), {
          message: 'The real reconnect refresh must reach the failing local trust read and its retry',
          timeout: 10_000,
        }).toBeGreaterThanOrEqual(2);
        await waitForHarnessReady(page, api);
        await expect(page.getByText(INSTALLED_GRANT, { exact: true })).toBeVisible();
        await expect(page.getByText(/simulating full requested-capability grant/)).toHaveCount(0);
        expect(await page.getByTestId(SANDBOX_BRIEF_ID).innerText()).toBe(retainedBrief);
        await expectCharts(page, STARTER_EXPECTATION);
        await reviewRun(page, STARTER_EXPECTATION, INSTALLED_GRANT, runStats);
      } finally {
        await restoreLocalTrustReads(page);
      }
      await page.evaluate(() => window.dispatchEvent(new Event('online')));
      await waitForHarnessReady(page, api);
      await expect(page.getByText(INSTALLED_GRANT, { exact: true })).toBeVisible();
      await selectTab(page, 'Import / export');
      await expect(page.getByRole('textbox', { name: 'Or paste envelope JSON', exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Choose file…', exact: true })).toBeVisible();
      const downloadPromise = page.waitForEvent('download');
      await page.getByRole('button', { name: 'Export', exact: true }).click();
      const download = await downloadPromise;
      expect(download.suggestedFilename()).toBe('intelligence-pack-efficiency-insights-starter-1.0.0.json');
      const stream = await download.createReadStream();
      if (!stream) throw new Error('The real installed-pack export did not produce readable content');
      const chunks: Buffer[] = [];
      for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      const exported: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      expect(exported).toEqual(starter);
      await page.getByRole('textbox', { name: 'Or paste envelope JSON', exact: true }).fill(JSON.stringify(exported));
      await page.getByRole('button', { name: 'Parse pasted JSON', exact: true }).click();
      const parsed = page.getByRole('dialog', { name: starter.manifest.name, exact: true });
      await expect(parsed.getByText('4 analytics formulas', { exact: true })).toBeVisible();
      await expect(parsed.getByRole('region', { name: 'Automation recommendations', exact: true })).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(parsed).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Export', exact: true })).toBeEnabled();
      await selectTab(page, 'Audit log');
      await expect(page.getByText('install', { exact: true })).toBeVisible();
      await expect(page.getByText('trust-decision', { exact: true })).toBeVisible();
      await expect(page.getByText('disable', { exact: true })).toBeVisible();
      await expect(page.getByText('enable', { exact: true })).toBeVisible();
      await selectTab(page, 'Security & methodology');
      await expect(page.getByText(/The sandbox proves computational safety, not real-world analytical correctness/)).toBeVisible();
      await expect(page.getByRole('table', { name: 'Resource ceilings & budgets in this build', exact: true })).toBeVisible();

      await selectTab(page, 'Catalog');
      const draft = DRAFT_EXPECTATION.envelope;
      await card(page, draft.manifest.name).getByRole('button', { name: 'View & install', exact: true }).click();
      await page.getByRole('dialog', { name: draft.manifest.name, exact: true })
        .getByRole('button', { name: 'Trust as local-development pack…', exact: true }).click();
      const unsigned = page.getByRole('dialog', { name: 'Trust this unsigned pack? (local development only)', exact: true });
      await expect(unsigned.getByRole('button', { name: 'Trust & install', exact: true })).toBeDisabled();
      await unsigned.getByRole('textbox', { name: 'Type "TRUST UNSIGNED" to confirm', exact: true }).fill('wrong phrase');
      await expect(unsigned.getByRole('button', { name: 'Trust & install', exact: true })).toBeDisabled();
      await unsigned.getByRole('button', { name: 'Cancel', exact: true }).click();
      await page.keyboard.press('Escape');
      await expect(card(page, draft.manifest.name).getByRole('button', { name: 'View & install', exact: true })).toBeVisible();
      const tampered = BUNDLED_ENVELOPES[2];
      await card(page, tampered.manifest.name).getByRole('button', { name: 'View & install', exact: true }).click();
      const blocked = page.getByRole('dialog', { name: tampered.manifest.name, exact: true });
      await expect(blocked.getByText('This pack cannot be installed', { exact: true })).toBeVisible();
      await expect(blocked.getByRole('button', { name: 'Install', exact: true })).toHaveCount(0);
      await expect(blocked.getByRole('button', { name: 'Trust as local-development pack…', exact: true })).toHaveCount(0);
      await expect(blocked.getByRole('button', { name: 'Record as blocked', exact: true })).toBeEnabled();
      await page.keyboard.press('Escape');
      await complete(page, api);
      await expectNoRuntimeFailures(diagnostics);
    });
  }
}
