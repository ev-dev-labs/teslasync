/** Authored, NOTRUN. Source bindings are not chart runtime/browser evidence. */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = existsSync(resolve(process.cwd(), 'src'))
  ? resolve(process.cwd(), 'src', 'features', 'charging')
  : resolve(process.cwd(), 'web', 'src', 'features', 'charging');
function source(...parts: string[]) { return readFileSync(resolve(root, ...parts), 'utf8'); }

describe('complete charging presentation exports', () => {
  it.each([
    ['SessionCurveChart', 'rows'],
    ['SessionComparisonChart', 'comparisonData'],
    ['SpeedTrendChart', 'tableData'],
  ])('passes every prepared row from %s to CSV', (component, rows) => {
    const text = source('components', 'charging-curve', `${component}.tsx`);
    expect(text).toContain(`exportData={${rows}}`);
    expect(text).toContain(`data={${rows}}`);
    expect(text).toContain('exportable');
  });
  it('preserves comparison order, original ten-session limit and every individual power column', () => {
    const text = source('components', 'charging-curve', 'SessionComparisonChart.tsx');
    expect(text).toContain('(sessions ?? []).slice(0, 10)');
    expect(text).toContain('data={comparisonData}');
    expect(text).toContain('exportData={comparisonData}');
    expect(text).toContain('...comparisonSessions.map(');
    expect(text).toContain('key: `s${index}`');
    expect(text).toContain('dataKey={`s${i}`}');
  });
  it('keeps unrounded specialist statistics and yearly counts in full CSV arrays', () => {
    const charger = source('components', 'charging-curve', 'ChargerTypeChart.tsx');
    expect(charger).toContain('exportData={chargerTypeStats.map(({ label, count, avgKw, avgKwh, avgDuration })');
    const yearly = source('components', 'charging-curve', 'YearlyTrendChart.tsx');
    expect(yearly).toContain('exportData={data.map(({ year, avg10to80, avg20to80, count })');
  });
  it('truncates site names only on visual axis ticks, never table or CSV values', () => {
    for (const text of [
      source('pages', 'ChargeInterruptionPage.tsx'),
      source('pages', 'ChargerResiliencePage.tsx'),
      source('components', 'charger-health-modernization', 'ChargerHealthChart.tsx'),
    ]) {
      expect(text).toContain('tickFormatter=');
      expect(text).not.toMatch(/site:\s*(?:s|site)\.label\.length/);
      expect(text).toContain('exportData={');
    }
  });
  it('preserves SI thermal readings including gaps and complete cost/forecast plot rows', () => {
    expect(source('components', 'charging-thermal-tax-modernization', 'ThermalPowerChart.tsx'))
      .toContain('exportData={data}');
    expect(source('components', 'cost-analysis', 'MonthlyCostChart.tsx'))
      .toContain('exportData={chartData}');
    expect(source('components', 'cost-analysis', 'CostPerKwhChart.tsx'))
      .toContain('exportData={rows}');
    const forecast = source('components', 'stat-modernization', 'CostForecastSection.tsx');
    expect(forecast).toContain('exportData={chartData}');
    expect(forecast).toContain('exportData={historicalData.map(');
    for (const key of ['actual', 'forecast', 'ci_low', 'ci_band', 'ci_high'])
      expect(forecast).toContain(key);
  });
  it('keeps prepared monthly and tariff datasets alongside existing complete table and JSON exports', () => {
    for (const file of ['TeslaChargingHistoryPage', 'TeslaChargingSessionsPage'])
      expect(source('pages', `${file}.tsx`)).toContain('exportData={monthlyData}');
    expect(source('pages', 'SmartChargePage.tsx')).toContain('exportData={safeArray(result?.hourly_rates).map(');
    const list = source('pages', 'ChargingListPage.tsx');
    expect(list).toContain('selectionScope="filtered"');
    expect(list).toContain('selectedIds={Array.from(bulkSelected)}');
  });
});
