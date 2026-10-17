import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import ts from 'typescript';

const path = resolve('src/features/analytics/pages/MileagePage.tsx');
const source = readFileSync(path, 'utf8');
const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const printer = ts.createPrinter({ removeComments: true });

function descendants(node: ts.Node): ts.Node[] {
  const result: ts.Node[] = [node];
  ts.forEachChild(node, child => { result.push(...descendants(child)); });
  return result;
}
const nodes = descendants(ast);
function printed(node: ts.Node) {
  return printer.printNode(ts.EmitHint.Unspecified, node, ast).replace(/\s+/g, '');
}
function opening(name: string) {
  return nodes.filter((node): node is ts.JsxOpeningElement | ts.JsxSelfClosingElement =>
    (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && node.tagName.getText(ast) === name);
}
function attribute(node: ts.JsxOpeningElement | ts.JsxSelfClosingElement, name: string) {
  return node.attributes.properties.find(prop => ts.isJsxAttribute(prop) && prop.name.getText(ast) === name);
}
function initializer(name: string) {
  const declaration = nodes.find((node): node is ts.VariableDeclaration =>
    ts.isVariableDeclaration(node) && node.name.getText(ast) === name);
  if (!declaration?.initializer) throw new Error(`Missing source derivation ${name}`);
  return printed(declaration.initializer);
}

describe('Mileage source and interaction identities', () => {
  it('retains the three chart preference/export identities and their accessible data columns', () => {
    const charts = opening('EmbeddedChart');
    expect(charts.map(chart => attribute(chart, 'chartKey')?.getText(ast))).toEqual([
      'chartKey="mileage-odometer-over-time"',
      'chartKey="mileage-daily-distance"',
      'chartKey="mileage-monthly-distance"',
    ]);
    charts.forEach((chart, index) => {
      const columns = attribute(chart, 'dataColumns');
      expect(columns).toBeDefined();
      expect(printed(columns!)).toContain(`key:'${index === 2 ? 'month' : 'date'}'`);
      expect(printed(columns!)).toContain(`key:'${index === 0 ? 'odometer' : 'distance'}'`);
      expect(printed(columns!)).toContain("knownNumber(value)==null?'—':fmtNumber(Number(value))");
      expect(attribute(chart, 'height')?.getText(ast)).toBe('height={288}');
      expect(attribute(chart, 'mobileHeight')?.getText(ast)).toBe('mobileHeight={256}');
    });
    expect(opening('Area')).toHaveLength(1);
    expect(opening('Bar')).toHaveLength(2);
    expect(opening('Tooltip')).toHaveLength(3);
    const area = opening('Area')[0];
    expect(attribute(area, 'stroke')?.getText(ast)).toBe('stroke={palette[2]}');
    expect(attribute(area, 'fill')?.getText(ast)).toBe('fill={palette[2]}');
    expect(attribute(area, 'fillOpacity')?.getText(ast)).toBe('fillOpacity={0.08}');
    expect(source).not.toContain("areaGradient('odoGrad'");
    expect(source).toContain("domain={['auto', 'auto']}");
  });

  it('retains monthly table persistence, value filtering, pagination and mobile-detail inputs', () => {
    const table = opening('DataTable')[0];
    expect(table).toBeDefined();
    expect(attribute(table, 'tableId')?.getText(ast)).toBe('tableId="analytics:mileage-monthly"');
    // No mobile allow-list: all four fields remain available at every width.
    expect(attribute(table, 'mobileColumns')).toBeUndefined();
    expect(attribute(table, 'caption')?.getText(ast))
      .toBe("caption={t('mileage.monthlySummary', 'Monthly summary')}");
    ['enableValueFilters', 'compact', 'pagination', 'keyExtractor', 'columns', 'data'].forEach(name =>
      expect(attribute(table, name)).toBeDefined());
    expect(initializer('monthColumns')).toContain("key:'dailyAvg'");
    expect(initializer('monthColumns')).toContain('sortable:true');
    expect(initializer('monthColumns')).toContain('filterValueLabel:');
    expect(initializer('monthColumns').match(/key:'/g)).toHaveLength(4);
    expect(initializer('monthColumns')).toContain("t('mileage.distancePerDrive','Distance/drive')");
    for (const field of ['distance', 'drives', 'dailyAvg']) {
      expect(initializer('monthColumns')).toContain(`r.${field}==null?'—':`);
    }
    expect(attribute(table, 'keyExtractor') && printed(attribute(table, 'keyExtractor')!))
      .toBe('keyExtractor={(r)=>r.month}');
  });

  it('keeps original source scope, null odometer exclusion and zero-drive division guard', () => {
    expect(initializer('statsQuery')).toBe('useMileageStats(activeId)');
    expect(initializer('dailyQuery')).toBe('useDailyMileage(activeId,90)');
    expect(initializer('monthlyQuery')).toBe('useMonthlyMileage(activeId)');
    expect(initializer('fromKm')).toContain('constreading=knownNumber(km)');
    expect(initializer('fromKm')).toContain('reading==null?null:convertDistanceFromSI(reading*1000,distanceUnit)');
    expect(initializer('odometerData')).toContain('.filter((d)=>knownNumber(d.end_odometer_km)!=null)');
    expect(initializer('dailyData')).toContain('distance:fromKm(d.total_km)');
    expect(initializer('monthlyRows')).toContain('constkm=knownNumber(m.total_km)');
    expect(initializer('monthlyRows')).toContain('constdrives=knownNumber(m.drive_count)');
    expect(initializer('monthlyRows')).toContain('dailyAvg:km==null||drives==null?null:drives>0?fromKm(km/drives):0');
    expect(initializer('lifetimeMax')).toBe('totalDistance==null?0:totalDistance>0?totalDistance:1');
    expect(initializer('totalDistance')).toBe('fromKm(stats?.lifetime_km)');
    expect(initializer('totalDrives')).toBe('knownNumber(stats?.drive_count_lifetime)');
  });

  it('preserves date-only formatting, source periods, stable card IDs and source retry actions', () => {
    for (const name of ['odometerData', 'dailyData']) {
      expect(initializer(name)).toContain('date:formatDayKey(d.date,{locale})');
    }
    expect(initializer('monthlyRows')).toContain("month:m.year_month??''");
    expect(initializer('activityItems')).toContain('formatDate(stats.first_drive_at)');
    expect(initializer('activityItems')).toContain('formatDate(stats.last_drive_at)');
    expect(initializer('cards').match(/id:'mileage-[^']+'/g)).toEqual([
      "id:'mileage-summary-card'", "id:'mileage-odometer-card'",
      "id:'mileage-windows-card'", "id:'mileage-daily-card'",
      "id:'mileage-monthly-card'", "id:'mileage-monthly-table-card'",
    ]);
    expect(opening('MileageSourceNotice')).toHaveLength(6);
    for (const notice of opening('MileageSourceNotice')) {
      const state = attribute(notice, 'source')?.getText(ast);
      const query = state === 'source={statsSource}' ? 'statsQuery'
        : state === 'source={dailySource}' ? 'dailyQuery'
          : state === 'source={monthlySource}' ? 'monthlyQuery' : undefined;
      expect(query).toBeDefined();
      expect(attribute(notice, 'onRetry') && printed(attribute(notice, 'onRetry')!))
        .toBe(`onRetry={()=>${query}.refetch()}`);
    }
    const refreshActions = opening('EmptyState').map(state => attribute(state, 'action'))
      .filter((action): action is ts.JsxAttribute => action != null && ts.isJsxAttribute(action));
    expect(refreshActions.map(printed)).toEqual([
      "action={{label:t('common.refresh','Refresh'),onClick:()=>{voidstatsQuery.refetch();}}}",
    ]);
    expect(source).toContain('they do not accept workspace date bounds');
  });

  it('retains summary operand meanings and navigable missing-data action at the live summary owner', () => {
    const summary = readFileSync(resolve(
      'src/features/analytics/components/operationalbrief-a-m/MileageBrief.tsx',
    ), 'utf8').replace(/\s+/g, '');
    expect(source).toContain("MileageBrief as MileageSummary");
    expect(summary).toContain('constdailyAvgKm=(stats?.last_30d_km??0)/30');
    expect(summary).toContain('rawValue:stats?.last_30d_km!=null?dailyAvgKm*1000:undefined');
    expect(summary).toContain('rawValue:stats?.last_30d_km!=null?dailyAvgKm*365*1000:undefined');
    for (const id of ['total-distance', 'total-drives', 'daily-average', 'annual-projection',
      'last-seven-days', 'last-year']) {
      expect(summary).toContain(`occurrenceId:'mileage-${id}'`);
    }
    expect(summary).toContain("actionTo={{label:t('statistics.viewDrives','Viewdrives'),to:'/drives'}}");
  });

  it('uses only one placement canvas and never adds workspace pickers or a second packing engine', () => {
    expect(opening('CardGrid')).toHaveLength(1);
    expect(opening('LayoutCard')).toHaveLength(6);
    expect(opening('PageLayout')).toHaveLength(1);
    ['RangePicker', 'DateRangeFilter', 'VehicleSelect', 'VehiclePicker'].forEach(name =>
      expect(opening(name)).toHaveLength(0));
    expect(source).not.toMatch(/new ResizeObserver|window\.innerWidth|packCardRows\(/);
    expect(source).not.toMatch(/max-w-|style=\{\{|from ['"](?:recharts|react-leaflet|framer-motion)['"]/);
    expect(source).not.toMatch(/<(?:button|input|textarea|select|table)\b/);
  });
});
