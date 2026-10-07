import { expect, test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { prepareCatalogueState } from './dashboardCatalogueStateHarness';
import { catalogueOperationalSources } from './dashboardCatalogueOperationalSources';
import { catalogueWire, installCatalogueRoutes } from './dashboardCatalogueRemainingSources';
import {
  assertCatalogueChargeQueryBinding, recordCatalogueChargeHistorySources, renderedChargeBinding,
} from './dashboardCatalogueChargeHistory';
import { captureCataloguePanel, positionCataloguePanel } from './dashboardCatalogueCapture';
import { assertCatalogueYAxisTickBounds } from './dashboardCatalogueGeometry';
import { assertMockApiComplete, waitForHarnessReady } from './mockApi';
import {
  attachDiagnostics, expectNoHorizontalOverflow, expectNoRuntimeFailures, monitorPage,
} from './qualityAssertions';

test.skip(process.env.E2E_MOCKS === '0', 'Requires isolated synthetic null-charger source');

for (const theme of ['light', 'dark'] as const) {
  for (const width of [390, 1440]) {
    test(`isolated Unknown charger null source retains701/7/42000Wh at ${width}px in ${theme}`, async ({ page }) => {
      test.setTimeout(90_000);
      const mocks = await prepareCatalogueState(page, ['charge-session-chart', 'charging-session-detail'], width, theme);
      const baseline = catalogueWire(catalogueOperationalSources(new Date().toISOString())['/charging/701']);
      if (!baseline || typeof baseline !== 'object' || Array.isArray(baseline)) {
        throw new Error('Missing original catalogue session constructor');
      }
      expect(baseline).toMatchObject({ id: 701, vehicle_id: 7, charger_type: 'AC', total_energy_added_wh: 42000 });
      const session = { ...baseline, charger_type: null };
      expect({ ...session, charger_type: 'AC' }, 'Null marker must be the sole change to the original constructor').toEqual(baseline);
      const sources = { '/charging': [session], '/charging-sessions': [session], '/charging/701': session };
      await installCatalogueRoutes(page, mocks, sources);
      const wire = recordCatalogueChargeHistorySources(page);
      const diagnostics = monitorPage(page);
      const chart = page.locator('[data-widget-id="state-charge-session-chart"] > .widget-panel');
      const detail = page.locator('[data-widget-id="state-charging-session-detail"] > .widget-panel');
      try {
        await writeFile(test.info().outputPath('isolated-null-source.json'), JSON.stringify({
          scenario: 'EXTRA_UNKNOWN_ONLY_NOT_ORIGINAL_AC_OR124', baseline, session, sources,
          soleSourceDifference: 'charger_type:null', width, theme, motion: 'no-preference',
        }, null, 2));
        await page.goto('/');
        await waitForHarnessReady(page, mocks);
        const chartBinding = await renderedChargeBinding(chart, 'state-charge-session-chart', 'chart');
        const detailBinding = await renderedChargeBinding(detail, 'state-charging-session-detail', 'detail');
        assertCatalogueChargeQueryBinding(chartBinding, 'state-charge-session-chart', 'chart', session);
        assertCatalogueChargeQueryBinding(detailBinding, 'state-charging-session-detail', 'detail', session);
        await Promise.all([...wire.pending]);
        expect(wire.errors).toEqual([]);
        const served = wire.responses.filter(response =>
          Object.keys(sources).some(path => new URL(response.url).pathname === `/api/v1${path}`));
        for (const [path, expected] of Object.entries(sources)) {
          const responses = served.filter(response => new URL(response.url).pathname === `/api/v1${path}`);
          expect(responses.length, `Actual ${path} null-source response must be recorded`).toBeGreaterThan(0);
          for (const response of responses) expect(response.body, 'All served fields/order/null must remain exact').toEqual(expected);
        }
        await positionCataloguePanel(detail);
        await expect(detail.getByText('Unknown', { exact: true })).toBeVisible();
        const detailEnergy = width === 390 ? detail.getByText('42.00', { exact: true })
          : detail.getByText('Energy added', { exact: true }).locator('..').getByText('42.00kWh', { exact: true });
        await expect(detailEnergy).toHaveCount(1);
        await expect(detailEnergy).toBeVisible();
        await expect(detail.getByRole('alert')).toHaveCount(0);
        await captureCataloguePanel(page, detail, test.info(), `unknown-detail-${width}-${theme}.png`);
        await positionCataloguePanel(chart);
        await expect(chart.getByText('Unknown', { exact: true })).toHaveCount(1);
        await expect(chart.getByText('Unknown', { exact: true })).toBeVisible();
        for (const label of ['Total', 'Avg']) {
          const metric = chart.getByText(label, { exact: true }).locator('..').getByText('42.00kWh', { exact: true });
          await expect(metric).toHaveCount(1);
          await expect(metric).toBeVisible();
        }
        await expect(chart.getByText('Sessions', { exact: true }).locator('..').getByText('1', { exact: true })).toBeVisible();
        await expect(chart.getByRole('alert')).toHaveCount(0);
        const table = chart.getByRole('table', { name: 'Charge sessions — data table', exact: true });
        await expect(table.getByRole('cell', { name: 'unknown', exact: true })).toHaveCount(1);
        await expect(table.getByRole('cell', { name: '42', exact: true })).toHaveCount(1);
        await assertCatalogueYAxisTickBounds(chart, 'charge-session-chart', test.info());
        const bar = chart.locator('.recharts-bar-rectangle .recharts-rectangle');
        await expect(bar).toHaveCount(1);
        const box = await bar.boundingBox();
        if (!box || box.width <= 0 || box.height <= 0) throw new Error('Unknown source must render a real nonzero energy bar');
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        const tooltip = chart.getByRole('tooltip');
        await expect(tooltip).toBeVisible();
        await expect(tooltip.getByText('Unknown:', { exact: true })).toBeVisible();
        await expect(tooltip).toContainText('42.00 kWh');
        await expect(tooltip).not.toContainText('Home / AC');
        await expect(tooltip).not.toContainText('Supercharger');
        const tooltipText = await tooltip.textContent();
        await captureCataloguePanel(page, chart, test.info(), `unknown-native-tooltip-${width}-${theme}.png`);
        await expect(tooltip.getByText('Unknown:', { exact: true })).toBeVisible();
        await page.mouse.move(0, 0);
        await expect(tooltip).toBeHidden();
        await expectNoHorizontalOverflow(page);
        await expectNoRuntimeFailures(diagnostics);
        await assertMockApiComplete(page, mocks);
        await writeFile(test.info().outputPath('unknown-native-contract.json'), JSON.stringify({
          scenario: 'EXTRA_UNKNOWN_ONLY_NOT_ORIGINAL124', width, theme, motion: 'no-preference',
          baseline, session, served, chartBinding, detailBinding, tooltipText, actualNonzeroBar: box,
          originalNormalACSourceUnchanged: true, originalSessionOrder: [701], originalEnergyWh: 42000,
          proofScope: 'Null charger_type only. Not all unrecognized strings/Tesla/connectors/universal states.',
        }, null, 2));
      } finally {
        await attachDiagnostics(test.info(), diagnostics);
        await writeFile(test.info().outputPath('page-diagnostics.json'), JSON.stringify(diagnostics, null, 2));
      }
    });
  }
}
