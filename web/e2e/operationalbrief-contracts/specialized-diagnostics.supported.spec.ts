import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  assertMockApiComplete, expectThemeApplied, installApiMocks,
  seedBrowserState, waitForHarnessReady,
} from '../mockApi';
import {
  expectDialogsInsideViewport, expectNoHorizontalOverflow,
  expectNoRuntimeFailures, monitorPage,
} from '../qualityAssertions';
import type { ServiceEvidencePackDocument } from '../../src/features/diagnostics/lib/serviceEvidencePack';
import {
  COMMON_LIMITATIONS, DIAGNOSTIC_SIGNALS, EXPECTED_QUALITY_SCORE, EXPECTED_SUMMARY,
  FOCAL_SIGNAL, HISTORY_END, HISTORY_START, MISSING_FOCAL_LIMITATIONS,
  NO_CAUSAL_PROOF, RELATED_SIGNALS, SAMPLE_COUNT, SCORE_BASIS,
  SOFTWARE_UPDATES, SOURCE_ATTRIBUTION, installDiagnosticFixtures,
  type DiagnosticFixtureControls,
} from './specialized-diagnostics.supported.fixtures';

const WORKSPACES = [
  {
    route: '/diagnostics/root-cause', testId: 'root-cause-summary',
    title: 'Evidence quality and focal shift', service: false,
    theme: 'dark', width: 1440,
  },
  {
    route: '/diagnostics/service-evidence', testId: 'service-evidence-summary',
    title: 'Export evidence and readiness', service: true,
    theme: 'light', width: 320,
  },
] as const;
type Workspace = typeof WORKSPACES[number];

async function start(page: Page, workspace: Workspace, focalEmpty = false) {
  await page.setViewportSize({ width: workspace.width, height: 900 });
  await page.emulateMedia({ colorScheme: workspace.theme, reducedMotion: 'reduce' });
  await seedBrowserState(page, workspace.theme, workspace.route);
  const diagnostics = monitorPage(page);
  const mocks = await installApiMocks(page, 'populated', workspace.theme);
  expect(mocks, 'supported diagnostics require the strict shared API harness').not.toBeNull();
  const controls = await installDiagnosticFixtures(page, mocks, workspace.service, focalEmpty);
  await page.goto(workspace.route);
  await waitForHarnessReady(page, mocks);
  await expectThemeApplied(page, workspace.theme);
  const brief = page.getByTestId(workspace.testId);
  await expect(brief).toHaveAttribute('data-operational-brief', 'true');
  await expect(brief).toContainText('Choose a focal signal');
  const window = page.getByRole('combobox', { name: 'Analysis window', exact: true });
  await expect(window).toHaveValue('72');
  await expect(window.getByRole('option')).toHaveText([
    'Last 24 hours', 'Last 3 days', 'Last 7 days', 'Last 30 days',
  ]);
  // Exercise only public selectors; no state injection or analysis endpoint.
  await window.selectOption('72');
  const focal = page.getByRole('combobox', { name: 'Focal signal', exact: true });
  await expect(focal.getByRole('option')).toHaveText(['Choose a signal', ...DIAGNOSTIC_SIGNALS]);
  expect(controls.historyRequests).toEqual([]);
  await focal.selectOption(FOCAL_SIGNAL);
  await waitForHarnessReady(page, mocks);
  await expect.poll(() => [...new Set(controls.historyRequests)].sort())
    .toEqual([...DIAGNOSTIC_SIGNALS].sort());
  expect(controls.availableRequests).toBeGreaterThan(0);
  expect(controls.softwareRequests).toBe(workspace.service ? 1 : 0);
  return { brief, mocks, diagnostics, controls };
}

async function metric(brief: Locator, key: string, value: string | RegExp, state = 'value') {
  const item = brief.locator(`[data-operational-metric="${key}"]`);
  await expect(item).toHaveAttribute('data-value-state', state);
  await expect(item.locator('[data-operational-value]')).toHaveText(value);
}

async function sourceEvidence(page: Page, focalMissing: boolean) {
  const focal = page.locator(`[data-signal-source="${FOCAL_SIGNAL}"]`);
  await expect(focal).toHaveAttribute('data-source-status', focalMissing ? 'unavailable' : 'ok');
  await expect(focal).toContainText(focalMissing ? 'No data available for this period' : '90 sample(s)');
  for (const signal of RELATED_SIGNALS) {
    const source = page.locator(`[data-signal-source="${signal}"]`);
    await expect(source).toHaveAttribute('data-source-status', 'ok');
    await expect(source).toContainText('90 sample(s)');
  }
}

async function positiveMetrics(brief: Locator, workspace: Workspace) {
  const prefix = workspace.service ? 'service-evidence' : 'root-cause';
  await metric(brief, `${prefix}-quality`, 'Moderate evidence');
  await metric(brief, `${prefix}-hypotheses`, '2');
  await expect(brief).toContainText('BatteryLevel · 72h requested history window');
  await expect(brief).toContainText('Signal evidence available');
  if (workspace.service) {
    await metric(brief, 'service-evidence-signals', '4');
    await metric(brief, 'service-evidence-pack-status', 'Ready');
    // The existing core counts hasEvidence graph flags, including its focal
    // node; this is not a count of successfully retrieved candidate histories.
    await expect(brief).toContainText('3 corroborating');
  } else {
    // 90 actual samples, two of three candidates and an 89-minute span:
    // 0.4*(90/200) + 0.35*(2/3) + 0.25*(89/1440) = 0.4287847…
    await metric(brief, 'root-cause-overall-score', '0.43');
    await metric(brief, 'root-cause-effect', /^50(?:\.0{1,2})?$/);
    await metric(brief, 'root-cause-focal-samples', String(SAMPLE_COUNT));
    await expect(brief).toContainText('3 candidates considered');
    await expect(brief).toContainText('72h window');
  }
}

async function missingMetrics(brief: Locator, workspace: Workspace) {
  const prefix = workspace.service ? 'service-evidence' : 'root-cause';
  await metric(brief, `${prefix}-quality`, 'Insufficient evidence');
  await metric(brief, `${prefix}-hypotheses`, '—', 'missing');
  await expect(brief).toContainText('Partial signal evidence');
  if (workspace.service) {
    await metric(brief, 'service-evidence-signals', '4');
    await metric(brief, 'service-evidence-pack-status', 'Not ready');
    await expect(brief).toContainText('1 corroborating');
  } else {
    await metric(brief, 'root-cause-overall-score', /^0(?:\.0{1,2})?$/);
    await metric(brief, 'root-cause-effect', '—', 'missing');
    await metric(brief, 'root-cause-focal-samples', '—', 'missing');
    await expect(brief).toContainText('Focal history unavailable; no shift conclusion can be drawn.');
    await expect(brief).toContainText('3 candidates considered');
  }
}

async function review(page: Page, brief: Locator, workspace: Workspace, missing = false) {
  const before = await brief.locator('[data-operational-metric]').allTextContents();
  const trigger = brief.getByRole('button', { name: 'Review details', exact: true });
  await trigger.focus();
  await trigger.press('Enter');
  const drawer = page.getByRole('dialog', { name: `${workspace.title} details`, exact: true });
  await expect(drawer).toBeVisible();
  await expect(drawer).toHaveAttribute('aria-modal', 'true');
  const narrative = drawer.getByTestId('operational-narrative');
  await expect(narrative).toContainText('What changed');
  await expect(narrative).toContainText('Not scored');
  await expect(narrative).toContainText(SCORE_BASIS);
  await expect(narrative).toContainText('Cause is not established by the available evidence.');
  await expect(narrative).toContainText('No action is recommended from this evidence alone.');
  await expect(narrative).toContainText(SOURCE_ATTRIBUTION);
  for (const limitation of COMMON_LIMITATIONS) await expect(narrative).toContainText(limitation);
  if (missing) {
    for (const limitation of MISSING_FOCAL_LIMITATIONS) await expect(narrative).toContainText(limitation);
    await expect(narrative).not.toContainText(EXPECTED_SUMMARY);
    await expect(narrative).not.toContainText('No robust shift was found for BatteryLevel');
    await expect(narrative).toContainText('never a diagnosis');
  } else {
    await expect(narrative).toContainText(EXPECTED_SUMMARY);
    await expect(narrative).toContainText(NO_CAUSAL_PROOF);
  }
  await expect(drawer.getByRole('heading', { name: 'Operational metrics', exact: true })).toBeVisible();
  await expectDialogsInsideViewport(page);
  await page.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);
  await expect(trigger).toBeFocused();
  expect(await brief.locator('[data-operational-metric]').allTextContents()).toEqual(before);
}

function focalRequestCount(controls: DiagnosticFixtureControls) {
  return controls.historyRequests.filter(signal => signal === FOCAL_SIGNAL).length;
}

async function generateActualPack(page: Page, brief: Locator) {
  const generate = page.getByRole('button', { name: 'Generate pack', exact: true });
  await expect(generate).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Download JSON', exact: true })).toHaveCount(0);
  await generate.click();
  await metric(brief, 'service-evidence-pack-status', 'Generated');
  const preview = page.getByRole('group', { name: 'Pack preview', exact: true });
  await expect(preview).toBeVisible();
  // This is the real client-generated document, not a fixture analysis result.
  const doc = JSON.parse(await preview.locator('code').innerText()) as ServiceEvidencePackDocument;
  expect(doc.focalSignal).toBe(FOCAL_SIGNAL);
  expect(doc.window).toEqual({
    hours: 72, earliestMs: Date.parse(HISTORY_START), latestMs: Date.parse(HISTORY_END),
  });
  expect(doc.quality.focalSampleCount).toBe(SAMPLE_COUNT);
  expect(doc.quality.overallScore).toBeCloseTo(EXPECTED_QUALITY_SCORE, 10);
  expect(doc.quality.band).toBe('moderate');
  expect(doc.quality.candidatesConsidered).toBe(3);
  expect(doc.quality.candidatesWithEvidence).toBe(2);
  expect(doc.quality.windowMs).toBe(89 * 60_000);
  expect(doc.focalShift?.effectSize).toBe(50);
  expect(doc.focalShift?.before.median).toBeGreaterThan(79.8);
  expect(doc.focalShift?.before.median).toBeLessThan(80.2);
  expect(doc.focalShift?.after.median).toBeGreaterThan(61.8);
  expect(doc.focalShift?.after.median).toBeLessThan(62.2);
  expect(doc.hypotheses).toHaveLength(2);
  const voltage = doc.hypotheses.find(row => row.signal === 'PackVoltage');
  const range = doc.hypotheses.find(row => row.signal === 'EstBatteryRange');
  expect(voltage?.relation).toBe('leads');
  expect(voltage?.lagMs).toBeLessThan(0);
  expect(voltage?.shift.before.median).toBeGreaterThan(379.6);
  expect(voltage?.shift.after.median).toBeLessThan(350.4);
  expect(range?.relation).toBe('lags');
  expect(range?.lagMs).toBeGreaterThan(0);
  expect(range?.shift.before.median).toBeGreaterThan(299_600);
  expect(range?.shift.after.median).toBeLessThan(270_400);
  expect(doc.hypotheses.every(row => row.sampleCount === SAMPLE_COUNT)).toBe(true);
  expect(doc.signalEvidence.map(row => row.signal).sort()).toEqual([...DIAGNOSTIC_SIGNALS].sort());
  expect(doc.signalEvidence.every(row => row.sampleCount === SAMPLE_COUNT)).toBe(true);
  expect(doc.signalEvidence.find(row => row.signal === 'IdealBatteryRange')?.hasEvidence).toBe(false);
  expect(doc.summary).toBe(EXPECTED_SUMMARY);
  expect(doc.limitations).toEqual([...COMMON_LIMITATIONS]);
  expect(doc.disclaimer).toBe(NO_CAUSAL_PROOF);
  expect(doc.softwareUpdates).toEqual(SOFTWARE_UPDATES.map(row => ({
    version: row.version, status: row.status, installedAt: row.installed_at,
  })));
  expect(doc.vehicle).toEqual({ id: 7, displayName: 'Aurora' });
  expect(doc.integrity.algorithm).toBe('SHA-256');
  expect(doc.integrity.isSignature).toBe(false);
  expect(doc.integrity.digestHex).toMatch(/^[0-9a-f]{64}$/);
  await expect(page.getByRole('button', { name: 'Download JSON', exact: true })).toBeEnabled();
}

for (const workspace of WORKSPACES) {
  test(`supported actual diagnostics positive signal evidence ${workspace.route}`, async ({ page }) => {
    const { brief, mocks, diagnostics } = await start(page, workspace);
    await sourceEvidence(page, false);
    await positiveMetrics(brief, workspace);
    await review(page, brief, workspace);
    if (workspace.service) {
      await generateActualPack(page, brief);
    } else {
      const hypotheses = page.locator('main ol li');
      await expect(hypotheses.filter({ hasText: 'PackVoltage' })).toContainText('leads');
      await expect(hypotheses.filter({ hasText: 'EstBatteryRange' })).toContainText('lags');
      await expect(hypotheses.filter({ hasText: 'IdealBatteryRange' })).toHaveCount(0);
    }
    await expectNoHorizontalOverflow(page);
    await expectNoRuntimeFailures(diagnostics);
    await assertMockApiComplete(page, mocks);
  });

  test(`supported actual diagnostics missing focal and held retry preserves related evidence ${workspace.route}`, async ({ page }) => {
    const { brief, mocks, diagnostics, controls } = await start(page, workspace, true);
    await sourceEvidence(page, true);
    await missingMetrics(brief, workspace);
    await review(page, brief, workspace, true);
    if (workspace.service) {
      await expect(page.getByRole('button', { name: 'Generate pack', exact: true })).toBeDisabled();
      await expect(page.getByRole('button', { name: 'Download JSON', exact: true })).toHaveCount(0);
    }
    const relatedBefore = controls.historyRequests.filter(signal => signal !== FOCAL_SIGNAL);
    const focalBefore = focalRequestCount(controls);
    const focalSource = page.locator(`[data-signal-source="${FOCAL_SIGNAL}"]`);
    controls.holdNextFocal();
    try {
      await focalSource.getByRole('button', { name: 'Retry', exact: true }).click();
      await expect.poll(() => focalRequestCount(controls)).toBe(focalBefore + 1);
      await expect(focalSource.getByRole('button', { name: 'Retry', exact: true })).toBeDisabled();
      await sourceEvidence(page, true);
      await missingMetrics(brief, workspace);
      if (workspace.service) {
        await expect(page.getByRole('button', { name: 'Generate pack', exact: true })).toBeDisabled();
      }
    } finally {
      controls.releaseFocal();
    }
    await waitForHarnessReady(page, mocks);
    await missingMetrics(brief, workspace);
    // A second real per-source retry resolves the focal history; no catalog,
    // related-series replacement, workspace injection or fake analysis API.
    controls.focalEmpty = false;
    await focalSource.getByRole('button', { name: 'Retry', exact: true }).click();
    await waitForHarnessReady(page, mocks);
    await sourceEvidence(page, false);
    await positiveMetrics(brief, workspace);
    expect(focalRequestCount(controls)).toBe(focalBefore + 2);
    expect(controls.historyRequests.filter(signal => signal !== FOCAL_SIGNAL)).toEqual(relatedBefore);
    await review(page, brief, workspace);
    if (workspace.service) await generateActualPack(page, brief);
    await expectNoHorizontalOverflow(page);
    await expectNoRuntimeFailures(diagnostics);
    await assertMockApiComplete(page, mocks);
  });
}
