import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Intentionally source contracts: these complement mounted component tests,
// and do not claim browser or real network execution.
const read = (relative: string) => readFileSync(new URL(relative, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const energy = read('../../pages/EnergyPage.tsx');
const health = read('../../pages/BatteryHealthPage.tsx');

describe('source-backed battery orchestration preservation', () => {
  it('retains original query arguments and independent business windows without a second selector', () => {
    expect(energy).toContain("persistKey: 'energy.range'");
    expect(energy).toContain('{ start: startDate }');
    expect(energy).toContain('limit: 100, start: startDate, end: endDate');
    expect(energy).toContain('day.date >= startDate && day.date <= endDate');
    expect(energy).toContain('useChargingTelemetryLatest(vehicleId ?? 0)');
    expect(energy).toContain("useVampireDrainStats(\n    vehicleId != null ? String(vehicleId) : null,");
    expect(health).toContain('useBatteryHealthAnalytics(vehicleIdStr)');
    expect(health).toContain('useChargingTelemetryLatest(vehicleId ?? 0)');
    for (const page of [energy, health]) {
      expect(page).not.toMatch(/<(RangePicker|DateRangeFilter|VehicleSelect)\b/);
      expect(page).not.toContain('/api/v1/');
    }
  });

  it('keeps all cost eligibility and source calculation operands instead of broadening coverage', () => {
    for (const contract of [
      'const sessionCapReached = sessions.length >= 100',
      'costedSessions.length === sessions.length', '&& !sessionCapReached',
      'scopedDriveEnergyWh / totalDistance', '(scopedDriveEnergyWh / 1000) * CO2_SAVED_KG_PER_KWH',
      'totalCost / toDistanceDisplay(totalDistance)',
      'totalCost / (costedEnergyWh / 1000)', 'estimateGasCost(totalDistance)',
      '(observedCost / periodDays) * 365',
      '(scopedDriveEnergyWh / periodDays) * 30',
      '(peakEfficiencyDay.efficiency_wh_per_m - bestEfficiencyDay.efficiency_wh_per_m) / avgEfficiency',
      "costCoverageComplete ? '' : '≥ '",
    ]) expect(energy).toContain(contract);
    for (const value of ['0.14', '0.18', '0.22', '0.3']) expect(energy).toContain(`= ${value};`);
  });

  it('retains every Energy chart series, export, legend, brush, annotation, synchronized cursor and table identity', () => {
    for (const key of ['energy-cost-daily', 'energy-efficiency-trend', 'energy-charging-time-of-day']) {
      expect(energy).toContain(`useHiddenSeries('${key}')`);
    }
    for (const key of ['energy', 'cost', 'efficiency', 'distance', 'count']) {
      expect(energy).toContain(`dataKey="${key}"`);
    }
    for (const identity of [
      'energy-cost-daily', 'efficiency-trend', 'charging-by-time', 'charger-breakdown',
      'energy.daily', 'battery:energy-sessions',
    ]) expect(energy).toContain(`"${identity}"`);
    expect(energy).toContain('<Brush');
    expect(energy).toContain('renderAnnotationLines(chartAnnotations');
    expect(energy).toContain('connectNulls={false}');
    expect(energy).toContain('syncMethod={sync.syncMethod}');
    expect(energy).toContain('ifOverflow="hidden"');
    expect(energy).toContain("mobileColumns={['date', 'energy', 'cost']}");
    expect(energy).toContain('data={sessions.slice(0, 15)}');
    expect(energy).toContain('pagination');
    expect(energy).toContain('to={`/charging/${s.id}`}');
    expect(energy).toContain('currentQuery={savedView.currentQuery}');
    expect(energy).toContain('onApply={savedView.apply}');
  });

  it('keeps health specialist eligibility, severity, history ordering, deferred chart props and exported helper API', () => {
    for (const contract of [
      'hasHealthMeasurement(health)', 'isProjectionTrustworthy(health?.prediction)',
      '(health.estimated_capacity_wh / health.original_capacity_wh) * 100',
      'history[0].range_m', 'history[history.length - 1].range_m',
      'health.original_capacity_wh - health.estimated_capacity_wh',
      'severityTokens[insightSeverity[ins.status]]',
      '<BatteryTrendCharts health={health} vehicleId={vehicleId} />',
      'analysis={health.charging_analysis}', 'totalCycles={health.total_cycles}',
      'recommendations.map((tip, idx)', 'insights.map((ins, i)',
      'computeEnergyBreakdown', 'degradationColor', 'gaugeColor', 'healthVariant',
      'export function healthTone', 'export function degradationTone',
    ]) expect(health).toContain(contract);
    const trends = read('../battery-health/BatteryTrendCharts.tsx');
    const charging = read('../battery-health/BatteryChargingCharts.tsx');
    for (const series of ['actual', 'predicted', 'range']) expect(trends).toContain(`dataKey="${series}"`);
    for (const series of ['startCount', 'endCount', 'value']) expect(charging).toContain(`dataKey="${series}"`);
  });

  it('retains the full source outline during loading, failure and cached refresh instead of replacing the page', () => {
    expect(energy).not.toContain('return <EnergyPageSkeleton');
    expect(energy).toContain('sessionsDataState.fatalError');
    expect(energy).toContain('<StaleRefreshWarning state={sessionsDataState}');
    expect(health).toContain('<HealthUnavailableOutline');
    expect(health).not.toMatch(/\berror=\{healthLoading/);
    expect(health).toContain('<StaleRefreshWarning state={healthDataState}');
    const unavailable = read('./HealthUnavailableOutline.tsx');
    for (const key of [
      'battery.hero.title', 'battery.bars.title', 'battery.chart.capacityTrend',
      'battery.chart.rangeTrend', 'battery.newVsNow.title', 'battery.insights.title',
      'battery.chart.chargeDist', 'battery.chart.acdc', 'battery.stats.title',
      'battery.recommendations.title',
    ]) expect(unavailable).toContain(key);
    expect(unavailable).toContain('{thermal}');
    expect(unavailable).toContain('{links}');
    expect(unavailable).toContain('battery-operational-brief');
    expect(unavailable).not.toContain('current_soh: 0');
  });

  it('uses canonical placement only: no new width observer, duplicate packer, inline geometry or raw controls', () => {
    const adapter = read('./BatteryPanelGrid.tsx');
    expect(adapter).toContain('useCardPlacement()');
    expect(adapter).toContain('<CardGrid label={label} items={items}');
    expect(adapter).not.toMatch(/ResizeObserver|useContainerWidth|packCardRows|style=\{/);
    for (const page of [energy, health]) {
      expect(page).toContain('<PageLayout');
      expect(page).not.toMatch(/<(button|input|textarea|select)\b/);
      expect(page).not.toMatch(/from ['"](recharts|react-leaflet|framer-motion)['"]/);
      expect(page).not.toMatch(/max-w-\[1600px\]|max-w-screen-2xl|empty=\{!health/);
    }
  });
});
