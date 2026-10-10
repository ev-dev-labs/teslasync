import { expect, test } from '@playwright/test';
import { ROUTE_REGISTRY } from '../../src/lib/routeRegistry';
import { analyzeCycleStress } from '../../src/features/battery/lib/cycleStress';
import {
  assertMockApiComplete, expectThemeApplied, installApiMocks,
  seedBrowserState, waitForHarnessReady,
} from '../mockApi';
import {
  expectDialogsInsideViewport, expectNoHorizontalOverflow, expectNoRuntimeFailures, monitorPage,
} from '../qualityAssertions';
import { installBatteryEndpoint, installExistingBatterySources } from './battery.fixtures';
import {
  cycleStressChargingWire, cycleStressDrivesWire, cycleStressExpected as expected,
  cycleStressHistoryQuery, cycleStressModelOperands, cycleStressNow,
} from './battery-cycle-stress.supported.fixtures';

test.use({ locale: 'en-US', timezoneId: 'UTC', reducedMotion: 'reduce' });
test.describe.configure({ timeout: 90_000 });

for (const theme of ['light', 'dark'] as const) {
  for (const width of [320, 1440]) {
    test(`positive cycle stress preserves bounded operands through sensitivity and review ${width} ${theme}`, async ({ page }) => {
      const path = '/cycle-stress';
      expect(ROUTE_REGISTRY.some(route => route.path === path)).toBe(true);
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: theme });
      await page.clock.setFixedTime(new Date(cycleStressNow));
      await seedBrowserState(page, theme, path);
      const mocks = await installApiMocks(page, 'populated', theme);
      if (!mocks) throw new Error('Positive cycle stress requires the existing strict mocked API harness');
      await installExistingBatterySources(page, mocks);
      const reads = { charging: 0, drives: 0 };
      await installBatteryEndpoint(page, mocks, '/charging', () => {
        reads.charging++;
        return cycleStressChargingWire;
      }, cycleStressHistoryQuery);
      await installBatteryEndpoint(page, mocks, '/drives', () => {
        reads.drives++;
        return cycleStressDrivesWire;
      }, cycleStressHistoryQuery);
      const diagnostics = monitorPage(page);
      const chargingResponse = page.waitForResponse(response =>
        new URL(response.url()).pathname === '/api/v1/charging' && response.request().method() === 'GET');
      const drivesResponse = page.waitForResponse(response =>
        new URL(response.url()).pathname === '/api/v1/drives' && response.request().method() === 'GET');
      await page.goto(path);
      await waitForHarnessReady(page, mocks);
      await expectThemeApplied(page, theme);
      await expect(page.getByText(/page failed to load/i)).toHaveCount(0);

      // Compare JSON numbers, never parse the presentation back into operands.
      expect(await (await chargingResponse).json()).toEqual(cycleStressChargingWire);
      expect(await (await drivesResponse).json()).toEqual(cycleStressDrivesWire);
      expect(cycleStressChargingWire.map(row => row.total_energy_added_wh)).toEqual([40_000, 40_000]);
      expect(cycleStressChargingWire.map(row => row.peak_power_w)).toEqual([null, null]);
      expect(cycleStressDrivesWire.map(row => [
        row.duration_s, row.distance_m, row.energy_used_wh, row.regen_energy_wh, row.avg_power_w,
      ])).toEqual([[3_600, 20_000, 4_000, 300, 5_000], [3_600, 20_000, 4_000, 300, 5_000]]);
      const raw = cycleStressModelOperands();
      const rawBefore = structuredClone(raw);
      const baseline = analyzeCycleStress(raw.sessions, raw.drives, Date.parse(cycleStressNow), 'UTC');
      expect(baseline.cycles.map(cycle => cycle.depthPct)).toEqual(expected.depthsPct);
      expect(baseline.cycles.map(cycle => cycle.count)).toEqual(expected.counts);
      expect(baseline.cycles.map(cycle => cycle.durationS)).toEqual(expected.durationS);
      expect(baseline.summary).toMatchObject({
        weightedCycleCount: expected.weightedCycleCount,
        equivalentFullCycles: expected.equivalentFullCycles,
        medianDepthPct: expected.medianDepthPct,
        depthWeightedIndex: expected.depthWeightedIndex17,
        deepCycleShare: expected.deepCycleShare60,
        composition: { fullCycleRecords: 0, halfCycleRecords: 4 },
      });
      expect(baseline.continuity).toEqual(expected.continuity);
      expect(baseline.monthTrend.map(point => point.monthKey)).toEqual(['2026-07', '2026-08']);
      for (const accounting of [baseline.driveAccounting, baseline.chargingAccounting]) {
        expect(accounting).toMatchObject({
          returnedRows: 2, includedRows: 2, excludedRows: 0, historyLimit: 1_000, historyCapReached: false,
        });
        expect(Object.entries(accounting.categories).filter(([key]) => key !== 'included')
          .map(([, count]) => count)).toEqual([0, 0, 0, 0, 0, 0, 0]);
      }

      const summary = page.getByTestId('cycle-stress-summary');
      const accountingSection = page.getByTestId('cycle-stress-accounting');
      const accounting = accountingSection.locator('[data-operational-brief]');
      const summaryMetric = (key: string) => summary.locator(`[data-operational-metric="cycle-stress:${key}"]`);
      const fmt = (value: number) => new Intl.NumberFormat('en-US', {
        minimumFractionDigits: 2, maximumFractionDigits: 2,
      }).format(value);
      await expect(summaryMetric('intervals')).toHaveAttribute('data-value-state', 'value');
      await expect(summaryMetric('intervals').locator('[data-operational-value]')).toHaveText(fmt(expected.acceptedIntervals));
      await expect(summaryMetric('efc').locator('[data-operational-value]')).toHaveText(fmt(expected.equivalentFullCycles));
      await expect(summaryMetric('median-depth')).toHaveAttribute('data-value-state', 'value');
      await expect(summaryMetric('median-depth').locator('[data-operational-value]')).toHaveText('55.0%');
      await expect(summaryMetric('deep-share').locator('[data-operational-value]')).toHaveText('25.0%');
      await expect(summaryMetric('depth-index').locator('[data-operational-value]')).toHaveText(fmt(expected.depthWeightedIndex17));
      const accountingBefore = await accounting.locator('[data-operational-metric]').allTextContents();
      for (const [key, count] of [
        ['rows-returned', expected.returnedRows], ['accepted-intervals', expected.acceptedIntervals],
        ['excluded-rows', expected.excludedRows], ['source-types', expected.sourceTypes],
      ] as const) {
        const metric = accounting.locator(`[data-operational-metric="${key}"]`);
        await expect(metric).toHaveAttribute('data-value-state', 'value');
        await expect(metric.locator('[data-operational-value]')).toHaveText(fmt(count));
      }
      await expect(accountingSection).toContainText('4 known returned = 4 included + 0 excluded.');
      for (const label of [
        'Incomplete / live (no explicit end)', 'Invalid timestamp or order', 'Future-dated end',
        'Missing SoC endpoint', 'Invalid SoC endpoint', 'Nonpositive or tiny directional change', 'Overlapping interval',
      ]) {
        await expect(accountingSection.getByText(label, { exact: true }).first()).toBeVisible();
      }
      const continuity = page.getByTestId('cycle-stress-continuity');
      for (const [label, value] of [
        ['Raw endpoint boundaries', '8.00'], ['Retained observations', '8.00'],
        ['Turning points', '6.00'], ['Continuity segments', '2'], ['Long-gap breaks', '1.00'],
        ['SoC-jump breaks', '0.00'], ['Rejected overlaps', '0.00'],
        ['Monotone points compacted', '2.00'], ['Coincident collapses', '0.00'],
      ] as const) {
        const card = continuity.locator('[data-role="metric-card"]').filter({
          has: page.getByText(label, { exact: true }),
        });
        await expect(card.locator('[data-role="metric-value"]')).toHaveText(value);
      }
      const composition = page.getByTestId('cycle-stress-composition');
      for (const [label, value] of [
        ['Full-cycle records', '0.00'], ['Half-cycle records', '4.00'], ['Weighted cycle count', '2.0'],
      ] as const) {
        await expect(composition.locator('[data-role="metric-card"]').filter({
          has: page.getByText(label, { exact: true }),
        }).locator('[data-role="metric-value"]')).toHaveText(value);
      }

      const initialReads = { ...reads };
      expect(initialReads.charging).toBeGreaterThan(0);
      expect(initialReads.drives).toBeGreaterThan(0);
      await page.getByLabel('Deep-cycle lens', { exact: true }).selectOption('40');
      await expect(summaryMetric('deep-share').locator('[data-operational-value]')).toHaveText('100.0%');
      await expect(summaryMetric('deep-share')).toContainText('40%+ cycle share');
      await expect(summaryMetric('depth-index').locator('[data-operational-value]')).toHaveText(fmt(expected.depthWeightedIndex17));
      expect(await accounting.locator('[data-operational-metric]').allTextContents()).toEqual(accountingBefore);
      await page.getByLabel('Depth exponent', { exact: true }).selectOption('2');
      await expect(summaryMetric('depth-index').locator('[data-operational-value]')).toHaveText(fmt(expected.depthWeightedIndex2));
      await expect(summaryMetric('depth-index')).toContainText('illustrative exponent 2');
      await expect(summaryMetric('deep-share').locator('[data-operational-value]')).toHaveText('100.0%');
      await expect(summaryMetric('median-depth').locator('[data-operational-value]')).toHaveText('55.0%');
      await expect(summaryMetric('efc').locator('[data-operational-value]')).toHaveText(fmt(expected.equivalentFullCycles));
      const sensitivity = analyzeCycleStress(raw.sessions, raw.drives, Date.parse(cycleStressNow), 'UTC', {
        deepThresholdPct: 40, exponent: 2,
      });
      expect(sensitivity.summary).toMatchObject({
        equivalentFullCycles: expected.equivalentFullCycles, medianDepthPct: expected.medianDepthPct,
        weightedCycleCount: expected.weightedCycleCount, deepCycleShare: expected.deepCycleShare40,
        depthWeightedIndex: expected.depthWeightedIndex2,
      });
      expect(sensitivity.continuity).toEqual(baseline.continuity);
      expect(sensitivity.driveAccounting).toEqual(baseline.driveAccounting);
      expect(sensitivity.chargingAccounting).toEqual(baseline.chargingAccounting);
      expect(raw).toEqual(rawBefore);
      expect(await accounting.locator('[data-operational-metric]').allTextContents()).toEqual(accountingBefore);
      expect(reads, 'sensitivity is local reconstruction, not a new history response').toEqual(initialReads);

      for (const brief of [summary, accounting]) {
        const publication = await brief.locator('[data-operational-metric]').allTextContents();
        const trigger = brief.getByRole('button', { name: 'Review details', exact: true });
        await trigger.focus();
        await trigger.press('Enter');
        const drawer = page.getByRole('dialog');
        await expect(drawer).toBeVisible();
        await expect(drawer).toContainText('not a selected-date-window or full-history total');
        if (brief === summary) {
          await expect(drawer).toContainText('55.0%');
          await expect(drawer).toContainText('100.0%');
          await expect(drawer).toContainText('illustrative exponent 2');
          await expect(drawer).toContainText('sum of count x depth fraction');
        } else {
          await expect(drawer).toContainText('available data: 2 drives + 2 charging');
          await expect(drawer).toContainText('after validation and overlap rejection');
        }
        await expectDialogsInsideViewport(page);
        await page.keyboard.press('Escape');
        await expect(drawer).toHaveCount(0);
        await expect(trigger).toBeFocused();
        expect(await brief.locator('[data-operational-metric]').allTextContents()).toEqual(publication);
      }
      await expectNoHorizontalOverflow(page);
      await expectNoRuntimeFailures(diagnostics);
      await assertMockApiComplete(page, mocks);
    });
  }
}
