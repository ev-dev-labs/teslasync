import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const here = dirname(fileURLToPath(import.meta.url));
const web = resolve(here, '../../../..');
const require = createRequire(resolve(web, 'package.json'));
const ts = require('typescript');
const baselineRoot = process.env.ANALYTICS_PHASE4_BASELINE;
const printer = ts.createPrinter({ removeComments: true });
const read = path => readFileSync(resolve(web, 'src', 'features', 'analytics', ...path.split('/')), 'utf8');
const readBaseline = path => readFileSync(resolve(baselineRoot, 'web', 'src', 'features', 'analytics', ...path.split('/')), 'utf8');
const parse = (path, text) => ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const print = (node, tree) => printer.printNode(ts.EmitHint.Unspecified, node, tree);
const declarations = tree => {
  const found = new Map();
  const visit = node => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) found.set(node.name.text, node);
    ts.forEachChild(node, visit);
  };
  visit(tree);
  return found;
};
const nodes = (tree, predicate) => {
  const found = [];
  const visit = node => {
    if (predicate(node)) found.push(node);
    ts.forEachChild(node, visit);
  };
  visit(tree);
  return found;
};

test('page query operands, clocks, conversions and specialist calculations remain baseline-exact',
  { skip: !baselineRoot }, () => {
    const cases = {
      'pages/MileageBudgetPage.tsx': ['budget', 'chartData', 'drivesQuery'],
      'pages/RegimeShiftsPage.tsx': ['summary', 'chartData', 'drivesQuery'],
      'pages/StatisticsPage.tsx': ['fromKm', 'whPerKmToDisplay', 'stateData', 'compData', 'statsQuery', 'fleetQuery'],
      'pages/DriveCalendarPage.tsx': ['calendar', 'compactHeatmap', 'drivesQuery'],
      'pages/MilestonesPage.tsx': ['baseOdometerKm', 'milestoneUnitKm', 'summary', 'baseDisplay', 'drivesQuery'],
      'pages/CarbonIntelligencePage.tsx': ['analysis', 'intensityQuery', 'periodQuery', 'lifetimeQuery', 'recommendationQuery'],
      'pages/DriveArchetypesPage.tsx': ['summary', 'historyQuery', 'queryState', 'refresh'],
    };
    for (const [path, names] of Object.entries(cases)) {
      const after = parse(path, read(path));
      const before = parse(path, readBaseline(path));
      const current = declarations(after);
      const original = declarations(before);
      for (const name of names) {
        assert.ok(original.has(name), `${path}: original ${name} exists`);
        assert.ok(current.has(name), `${path}: current ${name} exists`);
        assert.equal(print(current.get(name), after), print(original.get(name), before), `${path}: ${name}`);
      }
    }
  });

test('canonical chart shells retain every plot series, axis, annotation, tooltip and export projection',
  { skip: !baselineRoot }, () => {
    const paths = [
      'components/carbon-intelligence/CarbonIntensityCurve.tsx',
      'components/carbon-intelligence/CarbonMonthlyTrend.tsx',
      'components/drive-archetypes/ArchetypeCentroidMap.tsx',
      'components/drive-archetypes/ArchetypeClusterComposition.tsx',
      'components/drive-archetypes/ArchetypeConfidenceDistribution.tsx',
      'components/drive-archetypes/ArchetypeHourlyProfile.tsx',
      'components/drive-archetypes/ArchetypeMonthlyComposition.tsx',
      'components/drive-calendar/MonthlyActivityChart.tsx',
      'components/drive-calendar/WeekdayPatternChart.tsx',
      'components/odometer-milestones/MonthlyDistanceChart.tsx',
      'components/odometer-milestones/OdometerGrowthChart.tsx',
    ];
    const plots = new Set(['Area', 'Bar', 'Line', 'Scatter', 'XAxis', 'YAxis', 'ZAxis', 'ReferenceLine', 'Tooltip', 'ChartLegend']);
    const series = tree => nodes(tree, node =>
      (ts.isJsxSelfClosingElement(node) || ts.isJsxElement(node))
      && plots.has((ts.isJsxElement(node) ? node.openingElement : node).tagName.getText(tree)))
      .map(node => print(node, tree));
    for (const path of paths) {
      const after = parse(path, read(path));
      const before = parse(path, readBaseline(path));
      assert.deepEqual(series(after), series(before), `${path}: plotted evidence`);
      const current = declarations(after);
      const original = declarations(before);
      for (const name of ['rows', 'chartRows', 'exportRows', 'accessibilityRows', 'columns']) {
        if (original.has(name)) assert.equal(print(current.get(name), after), print(original.get(name), before), `${path}: ${name}`);
      }
      assert.match(read(path), /<ChartCard\s+size="standard"/);
    }
  });

test('statistics tables and exports use the plotted state and full fleet rows', () => {
  const path = 'pages/StatisticsPage.tsx';
  const tree = parse(path, read(path));
  const charts = nodes(tree, node =>
    ts.isJsxOpeningElement(node) && node.tagName.getText(tree) === 'ChartCard');
  assert.equal(charts.length, 2);
  const get = (chart, name) => chart.attributes.properties.find(attribute =>
    ts.isJsxAttribute(attribute) && attribute.name.getText(tree) === name)?.initializer;
  for (const [index, source] of ['stateData', 'compData'].entries()) {
    assert.equal(get(charts[index], 'data').expression.getText(tree), source);
    assert.equal(get(charts[index], 'exportData').expression.getText(tree), source);
  }
  assert.match(get(charts[0], 'dataColumns').getText(tree), /key: 'value'/);
  assert.match(get(charts[1], 'dataColumns').getText(tree), /key: 'distance'/);
  assert.match(get(charts[1], 'dataColumns').getText(tree), /key: 'energy'/);
  assert.match(read(path), /chartKey="fleet-vehicle-comparison"/);
});
