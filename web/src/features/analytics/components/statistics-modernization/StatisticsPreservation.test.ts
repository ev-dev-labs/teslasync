import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import ts from 'typescript';
import { knownNumber } from '@/api/dataState';

// Source guards complement, rather than replace, the read-only page runtime tests.
const feature = resolve(process.cwd(), 'src/features/analytics');
const page = readFileSync(resolve(feature, 'pages/StatisticsPage.tsx'), 'utf8');
const component = (name: string) =>
  readFileSync(resolve(feature, `components/statistics-modernization/${name}.tsx`), 'utf8');

// Execute the actual page derivations without mounting its unrelated query/UI tree.
function derive<T>(name: string, scope: Record<string, unknown>): T {
  const ast = ts.createSourceFile('StatisticsPage.tsx', page, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let callback: ts.Expression | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name
      && node.initializer && ts.isCallExpression(node.initializer)
      && node.initializer.expression.getText(ast) === 'useMemo') {
      callback = node.initializer.arguments[0];
    }
    ts.forEachChild(node, visit);
  };
  visit(ast);
  if (!callback) throw new Error(`Missing ${name} useMemo derivation`);
  const compiled = ts.transpileModule(`const derive = ${callback.getText(ast)};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const evaluate = new Function(...Object.keys(scope), `${compiled}\nreturn derive();`) as
    (...values: unknown[]) => T;
  return evaluate(...Object.values(scope));
}

const fleetValues = (distance: unknown, energy: unknown) =>
  derive<Array<{ name: string; distance: number | null; energy: number | null }>>('compData', {
    fleet: { vehicle_comparison: [{ id: 1, name: 'Vehicle', distance, energy }] },
    fromKm: (km: number) => km / 1.609344,
    knownNumber,
    t: (key: string) => key,
  })[0];

const stateShares = (percentages: unknown[]) =>
  derive<Array<{ value: number | null }>>('stateData', {
    stateSummary: percentages.map(percentage => ({ state: 'driving', percentage })),
    knownNumber,
    STATE_LABELS: { driving: 'digitalTwin.statusLabel.driving' },
    STATE_SERIES: { driving: 1 },
    palette: ['charging', 'driving'],
    t: (key: string) => key,
  }).map(row => row.value);

describe('statistics modernization source contracts', () => {
  it('keeps query identity, enabled behavior and precise range bounds', () => {
    expect(page).toContain("queryKey: ['period-stats', activeId]");
    expect(page).toContain('/analytics/period-stats?vehicle_id=${activeId}');
    expect(page).toContain('enabled: !!activeId');
    expect(page).toContain('useFleetAnalytics({ start: startInstant, end: endInstantExclusive })');
    expect(page).toContain('useStateSummary(activeId, { start: startInstant, end: endInstantExclusive })');
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
    expect(page).toContain('convertEfficiencyFromSI(whPerKm, distanceUnit)');
  });

  it('keeps chart series, legend state, export identities and source aggregation', () => {
    expect(page.match(/<ChartCard\b/g)).toHaveLength(2);
    expect(page).toContain('percentage != null && percentage >= 0 && percentage <= 100');
    expect(page).toContain('Math.round(percentage) : null');
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

  it.each([undefined, null, NaN, Infinity, -Infinity, '', 'invalid'])(
    'keeps missing/invalid chart inputs unknown rather than measured zero (%s)',
    value => {
      expect(fleetValues(value, value)).toEqual({ name: 'Vehicle', distance: null, energy: null });
      expect(fleetValues(value, 0)).toEqual({ name: 'Vehicle', distance: null, energy: 0 });
      expect(fleetValues(0, value)).toEqual({ name: 'Vehicle', distance: 0, energy: null });
      expect(stateShares([value, 30])).toEqual([null, 30]);
    },
  );

  it('keeps measured zero distinct from unknown in fleet values and source state shares', () => {
    expect(fleetValues(0, 0)).toEqual({ name: 'Vehicle', distance: 0, energy: 0 });
    expect(stateShares([0, 100])).toEqual([0, 100]);
    expect(stateShares([0, 0])).toEqual([0, 0]);
  });

  it.each([1, -1, 1.75, -1.75])(
    'keeps valid signed and fractional fleet values with original conversion and rounding (%s)',
    value => {
      expect(fleetValues(value * 1.609344, value)).toEqual({
        name: 'Vehicle', distance: Math.round(value), energy: Math.round(value),
      });
    },
  );

  it('rounds fractional source percentages and rejects shares outside 0-100', () => {
    expect(stateShares([25.4, 74.6])).toEqual([25, 75]);
    expect(stateShares([62.5, 12.5])).toEqual([63, 13]);
    expect(stateShares([-0.5, 100.5, 101])).toEqual([null, null, null]);
  });

  it('keeps freshness, saved views, refresh and both empty-state destinations', () => {
    expect(page).toContain('<FreshnessDotAuto query={statsQuery} />');
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
