import { expect, test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { prepareCatalogueState } from './dashboardCatalogueStateHarness';
import { installAxisFormatterSources, type AxisFormatterScenario } from './dashboardCatalogueAxisFormatterFixtures';
import { assertCatalogueYAxisTickBounds } from './dashboardCatalogueGeometry';
import { assertMockApiComplete, waitForHarnessReady, waitForNoVisibleActivity } from './mockApi';
import {
  attachDiagnostics, expectNoHorizontalOverflow, expectNoRuntimeFailures, monitorPage,
} from './qualityAssertions';

test.skip(process.env.E2E_MOCKS === '0', 'Requires strict local typed axis formatter sources');

for (const scenario of ['signed-grouped-eight', 'group-boundary-nice-domain'] as const satisfies readonly AxisFormatterScenario[]) {
  for (const locale of ['en-US', 'de-DE'] as const) {
    for (const theme of ['light', 'dark'] as const) {
      test(`axis formatter ${scenario} ${locale} in ${theme}`, async ({ page }) => {
        test.setTimeout(90_000);
        const mocks = await prepareCatalogueState(page, ['cost-breakdown', 'power-flow-history'], 1440, theme);
        const source = await installAxisFormatterSources(page, mocks, scenario, locale, theme);
        const diagnostics = monitorPage(page);
        const format = new Intl.NumberFormat(locale, { minimumFractionDigits: 8, maximumFractionDigits: 8 });
        const grouped = locale === 'en-US' ? /-?\d{1,3}(?:,\d{3})+\.\d{8}$/ : /-?\d{1,3}(?:\.\d{3})+,\d{8}$/;
        const fractional = locale === 'en-US' ? /\.\d{8}$/ : /,\d{8}$/;
        const parseLabel = (text: string) => Number(locale === 'en-US'
          ? text.replace(/^\$/, '').replace(/,/g, '')
          : text.replace(/^\$/, '').replace(/\./g, '').replace(',', '.'));
        try {
          expect(source.displaySamples.every(Number.isFinite)).toBe(true);
          expect(source.history.flatMap(row => [row.solar_power, row.battery_power, row.grid_power, row.load_power])
            .every(value => typeof value === 'number' && Number.isFinite(value))).toBe(true);
          await writeFile(test.info().outputPath('formatter-source.json'), JSON.stringify({
            ...source, baseUrl: process.env.E2E_BASE_URL, status: 'synthetic-finite-source-not-browser-accepted',
          }, null, 2));
          await page.goto('/');
          await waitForHarnessReady(page, mocks);
          await waitForNoVisibleActivity(page);
          for (const id of ['cost-breakdown', 'power-flow-history']) {
            const panel = page.locator(`[data-widget-id="state-${id}"] > .widget-panel`);
            await panel.scrollIntoViewIfNeeded();
            await panel.evaluate(element => element.scrollIntoView({ block: 'center', behavior: 'instant' }));
            await expect(panel.getByRole('heading').first()).toBeVisible();
            await expect(panel.getByRole('alert')).toHaveCount(0);
            if (id === 'cost-breakdown') {
              // A negative monthly credit selects the genuine signed-bar branch.
              await expect(panel.locator('.recharts-pie-sector')).toHaveCount(0);
              for (const value of source.displaySamples) await expect(panel).toContainText(`$${format.format(value)}`);
              await expect(panel.locator('.recharts-bar-rectangle')).toHaveCount(source.displaySamples.length);
            } else {
              const meanSolar = source.history.reduce((sum, row) => {
                if (row.solar_power == null || !Number.isFinite(row.solar_power)) throw new Error('Missing finite solar source');
                return sum + row.solar_power / 1000;
              }, 0) / source.history.length;
              await expect(panel).toContainText(format.format(meanSolar));
              await expect(panel.locator('.recharts-area-curve')).toHaveCount(4);
              for (const curve of await panel.locator('.recharts-area-curve').all()) {
                expect(await curve.getAttribute('d'), 'Finite source must render actual curve points').toMatch(/^M.+/);
              }
            }
            const ticks = await assertCatalogueYAxisTickBounds(panel, id, test.info());
            for (const tick of ticks) expect(tick.text).toMatch(fractional);
            expect(ticks.some(tick => grouped.test(tick.text ?? '')), 'Grouped complete glyphs must actually render').toBe(true);
            const numericTicks = ticks.map(tick => parseLabel(tick.text ?? ''));
            expect(numericTicks.every(Number.isFinite)).toBe(true);
            if (scenario === 'signed-grouped-eight') {
              expect(ticks.some(tick => (tick.text ?? '').includes('-') && grouped.test(tick.text ?? '')),
                'Negative grouped eight-decimal tick must actually render').toBe(true);
            } else {
              const plotted = id === 'cost-breakdown' ? source.displaySamples
                : source.history.flatMap(row => [row.solar_power, row.battery_power, row.grid_power, row.load_power])
                  .map(value => value / 1000);
              expect(Math.max(...plotted)).toBeLessThan(1000);
              expect(Math.max(...numericTicks), 'Nice domain must cross the 999-to-1,000 digit-group boundary')
                .toBeGreaterThanOrEqual(1000);
            }
            await panel.screenshot({ path: test.info().outputPath(`${id}-${scenario}-${locale}-${theme}.png`) });
            await writeFile(test.info().outputPath(`${id}-formatter-contract.json`), JSON.stringify({
              status: 'passed', baseUrl: process.env.E2E_BASE_URL, scenario, locale, precision: 8,
              samples: source.displaySamples, numericTicks,
            }, null, 2));
          }
          await assertMockApiComplete(page, mocks);
          await expectNoHorizontalOverflow(page);
          await expectNoRuntimeFailures(diagnostics);
        } finally {
          await attachDiagnostics(test.info(), diagnostics);
          await writeFile(test.info().outputPath('page-diagnostics.json'), JSON.stringify(diagnostics, null, 2));
        }
      });
    }
  }
}
