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
    charts.forEach(chart => {
      expect(attribute(chart, 'dataColumns')).toBeDefined();
      expect(attribute(chart, 'height')?.getText(ast)).toBe('height={288}');
      expect(attribute(chart, 'mobileHeight')?.getText(ast)).toBe('mobileHeight={256}');
    });
    expect(opening('Area')).toHaveLength(1);
    expect(opening('Bar')).toHaveLength(2);
    expect(opening('Tooltip')).toHaveLength(3);
    expect(source).toContain("areaGradient('odoGrad', palette[2])");
    expect(source).toContain("domain={['auto', 'auto']}");
  });

  it('retains monthly table persistence, value filtering, pagination and mobile-detail inputs', () => {
    const table = opening('DataTable')[0];
    expect(table).toBeDefined();
    expect(attribute(table, 'tableId')?.getText(ast)).toBe('tableId="analytics:mileage-monthly"');
    expect(attribute(table, 'mobileColumns') && printed(attribute(table, 'mobileColumns')!))
      .toBe("mobileColumns={['month','distance','drives']}");
    ['enableValueFilters', 'compact', 'pagination', 'keyExtractor', 'columns', 'data'].forEach(name =>
      expect(attribute(table, name)).toBeDefined());
    expect(initializer('monthColumns')).toContain("key:'dailyAvg'");
    expect(initializer('monthColumns')).toContain('sortable:true');
    expect(initializer('monthColumns')).toContain('filterValueLabel:');
  });

  it('keeps original source scope, null odometer exclusion and zero-drive division guard', () => {
    expect(initializer('statsQuery')).toBe('useMileageStats(activeId)');
    expect(initializer('dailyQuery')).toBe('useDailyMileage(activeId,90)');
    expect(initializer('monthlyQuery')).toBe('useMonthlyMileage(activeId)');
    expect(initializer('fromKm')).toContain('convertDistanceFromSI((km??0)*1000,distanceUnit)');
    expect(initializer('odometerData')).toContain('.filter((d)=>d.end_odometer_km!=null)');
    expect(initializer('dailyData')).toContain('distance:fromKm(d.total_km??0)');
    expect(initializer('monthlyRows')).toContain('dailyAvg:drives>0?fromKm(km/drives):0');
    expect(initializer('lifetimeMax')).toBe('totalDistance>0?totalDistance:1');
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
