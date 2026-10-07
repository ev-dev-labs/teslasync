import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Source guards complement, rather than replace, the read-only page runtime tests.
const feature = resolve(process.cwd(), 'src/features/analytics');
const page = readFileSync(resolve(feature, 'pages/StatisticsPage.tsx'), 'utf8');
const component = (name: string) =>
  readFileSync(resolve(feature, `components/statistics-modernization/${name}.tsx`), 'utf8');

describe('statistics modernization source contracts', () => {
  it('keeps query identity, enabled behavior and both original fleet bounds', () => {
    expect(page).toContain("queryKey: ['period-stats', activeId]");
    expect(page).toContain('/analytics/period-stats?vehicle_id=${activeId}');
    expect(page).toContain('enabled: !!activeId');
    expect(page).toContain('useFleetAnalytics({ start: startDate, end: endDate })');
    expect(page).toContain("persistKey: 'statistics.range'");
    expect(page).toContain("defaultPresetId: '1y'");
    expect(page).not.toMatch(/RangePicker|VehicleSelect|ResizeObserver|useContainerWidth/);
  });

  it('keeps every metric and specialist unit/calculation boundary', () => {
    const period = component('PeriodStatistics');
    const battery = component('BatteryStatistics');
    const mileage = component('MileageStatistics');
    expect(period.match(/<MetricCard\b/g)).toHaveLength(8);
    expect(battery.match(/<MetricCard\b/g)).toHaveLength(4);
    expect(mileage.match(/<MetricCard\b/g)).toHaveLength(4);
    expect(period).toContain('(stats.total_distance ?? 0) / stats.total_drives');
    expect(period).toContain('formatCurrency((stats.total_cost ?? 0) / stats.total_distance)');
    expect(battery).toContain('Math.round(batteryHealth.current_soh ?? 0)');
    expect(battery).toContain('formatEnergy(batteryHealth.estimated_capacity_wh ?? 0)');
    expect(mileage).toContain('fromKm(((mileage.last_30d_km ?? 0) / 30) * 365)');
    expect(page).toContain('convertDistanceFromSI(km * METERS_PER_KM, distanceUnit)');
    expect(page).toContain('whPerKm * KM_PER_MILE');
  });

  it('keeps chart series, legend state, export identities and source aggregation', () => {
    expect(page.match(/<ChartCard\b/g)).toHaveLength(2);
    expect(page).toContain('Math.round((minutes / Math.max(total, 1)) * 100)');
    expect(page).toContain('Math.round(fromKm(v.distance))');
    expect(page).toContain('Math.round(v.energy)');
    expect(page).toContain('innerRadius={50} outerRadius={90} paddingAngle={3}');
    expect(page).toContain('<Legend />');
    expect(page).toContain('<ChartLegend state={fleetCompareHidden} />');
    expect(page).toContain("fleetCompareHidden.isHidden('distance')");
    expect(page).toContain("fleetCompareHidden.isHidden('energy')");
    expect(page).toContain('exportFilename="state-distribution"');
    expect(page).toContain('exportFilename="vehicle-comparison"');
    expect(page).toContain('chartKey="fleet-vehicle-comparison"');
    expect(page).toContain('height={280}');
    expect(page).toContain('height={300}');
  });

  it('keeps freshness, saved views, refresh and both empty-state destinations', () => {
    expect(page).toContain('<DataFreshnessAuto query={statsQuery} />');
    expect(page).toContain('route="/statistics"');
    expect(page).toContain('currentQuery={savedView.currentQuery}');
    expect(page).toContain('onApply={savedView.apply}');
    expect(page).toContain('void refetch()');
    expect(component('PeriodStatistics')).toContain("to: '/drives'");
    expect(page).toContain("to: '/vehicles'");
    expect(page.match(/<Section\b/g)).toHaveLength(3);
    expect(page.match(/<CardGrid\b/g)).toHaveLength(3);
  });
});
