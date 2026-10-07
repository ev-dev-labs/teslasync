import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

const directory = fileURLToPath(new URL('.', import.meta.url));
const pagePath = fileURLToPath(new URL('../../pages/FleetComparePage.tsx', import.meta.url));
const page = readFileSync(pagePath, 'utf8');
const originalPath = process.env.FLEET_COMPARE_ORIGINAL;
assert.ok(originalPath, 'Supply the acquired ORIGINAL path; never substitute HEAD');
const original = readFileSync(originalPath, 'utf8');
const parse = text => ts.createSourceFile('page.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const currentTree = parse(page);
const originalTree = parse(original);

function nodes(tree, predicate) {
  const result = [];
  const visit = node => {
    if (predicate(node)) result.push(node);
    ts.forEachChild(node, visit);
  };
  visit(tree);
  return result;
}
function initializer(tree, name) {
  const declaration = nodes(tree, node => ts.isVariableDeclaration(node) && node.name.getText(tree) === name)[0];
  assert.ok(declaration?.initializer, name);
  return declaration.initializer.getText(tree);
}
function hooks(tree) {
  const names = new Set(['useVehicles', 'useVehicleState', 'useDrivingStats', 'useCostBreakdown', 'useMonthlyMileage']);
  return nodes(tree, node => ts.isCallExpression(node) && names.has(node.expression.getText(tree)))
    .map(node => node.getText(tree));
}
function elements(tree, names) {
  return nodes(tree, node => (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node))
    && names.includes(node.tagName.getText(tree))).map(node => node.getText(tree));
}
function metricRows(tree) {
  return nodes(tree, node => ts.isObjectLiteralExpression(node)
    && node.properties.some(property => ts.isPropertyAssignment(property) && property.name.getText(tree) === 'rawA'));
}
function property(row, name, tree) {
  const item = row.properties.find(prop => ts.isPropertyAssignment(prop) && prop.name.getText(tree) === name);
  assert.ok(item, name);
  return item.initializer;
}
const helper = readFileSync(`${directory}comparisonPresentation.ts`, 'utf8');
const output = ts.transpileModule(helper, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const exports = {};
vm.runInNewContext(output, { exports });
const { getWinner, formatKnown } = exports;

test('specialist formatter is untouched for finite zero and measurements; unknown does not invoke it', () => {
  const seen = [];
  const formatter = value => { seen.push(value); return `specialist:${value}`; };
  assert.equal(formatKnown(0, formatter), 'specialist:0');
  assert.equal(formatKnown(1200.125, formatter), 'specialist:1200.125');
  for (const value of [null, undefined, NaN, Infinity, -Infinity]) {
    assert.equal(formatKnown(value, formatter), '—');
  }
  assert.deepEqual(seen, [0, 1200.125]);
});

test('higher/lower/neutral semantics match the original for every finite operand', () => {
  for (const a of [-10, 0, 1, 100]) for (const b of [-10, 0, 1, 100]) {
    for (const semantic of ['higher', 'lower', 'neutral']) {
      const expected = semantic === 'neutral' || a === b ? 'tie'
        : semantic === 'higher' ? a > b ? 'a' : 'b' : a < b ? 'a' : 'b';
      assert.equal(getWinner(a, b, semantic), expected);
    }
  }
});

test('missing or non-finite measurements cannot win against real zero', () => {
  for (const missing of [null, NaN, Infinity, -Infinity]) {
    for (const semantic of ['higher', 'lower', 'neutral']) {
      assert.equal(getWinner(missing, 0, semantic), 'tie');
      assert.equal(getWinner(0, missing, semantic), 'tie');
    }
  }
});

test('bounded syntax parse of the page and owned TypeScript files only', () => {
  const sources = [[pagePath, page], ...readdirSync(directory)
    .filter(name => /\.tsx?$/.test(name))
    .map(name => [name, readFileSync(`${directory}${name}`, 'utf8')])];
  for (const [name, source] of sources) {
    assert.deepEqual(parse(source).parseDiagnostics.map(diagnostic => diagnostic.messageText), [], name);
  }
});

test('all nine query invocations and arguments are byte-identical to the acquisition', () => {
  assert.equal(hooks(currentTree).length, 9);
  assert.deepEqual(hooks(currentTree), hooks(originalTree));
});

test('monthly union, zero-fill, source km/count and chronological sort are byte-identical', () => {
  for (const name of ['monthlyChartData', 'drivesChartData', 'KM_PER_MILE', 'fromKm', 'fromKmh', 'whPerKmToDisplay']) {
    assert.equal(initializer(currentTree, name), initializer(originalTree, name), name);
  }
});

test('deep links, cross-disabled selectors, auto-selection, swap and dismissal identity are preserved', () => {
  for (const name of ['initialLeftId', 'initialRightId', 'optionsA', 'optionsB', 'swapVehicles', 'bannerVisible', 'dismissBanner', 'BANNER_DISMISSED_KEY']) {
    // Destructured useState variables are tested via the actual unchanged source below.
    if (name === 'bannerVisible') continue;
    assert.equal(initializer(currentTree, name), initializer(originalTree, name), name);
  }
  for (const source of [
    "searchParams.get('leftId')", "searchParams.get('rightId')",
    'useState<string>(initialLeftId)', 'useState<string>(initialRightId)',
    "window.localStorage.getItem(BANNER_DISMISSED_KEY) !== '1'",
    'if (!vehicleIdA) setVehicleIdA(String(vehicleList[0].id))',
    'if (!vehicleIdB) setVehicleIdB(String(vehicleList[1].id))',
    'to="/period-compare"', "navigate('/vehicles')",
  ]) assert.ok(page.includes(source), source);
  assert.deepEqual(elements(currentTree, ['Select', 'Button']), elements(originalTree, ['Select', 'Button']));
});

test('all ten lifetime metrics retain fields, order, raw operands and winner direction', () => {
  const before = metricRows(originalTree);
  const after = metricRows(currentTree);
  assert.equal(after.length, 10);
  assert.equal(before.length, 10);
  for (let index = 0; index < before.length; index++) {
    assert.equal(property(after[index], 'metric', currentTree).getText(currentTree),
      property(before[index], 'metric', originalTree).getText(originalTree));
    for (const name of ['rawA', 'rawB']) {
      const oldOperand = property(before[index], name, originalTree);
      const newOperand = property(after[index], name, currentTree);
      assert.ok(ts.isBinaryExpression(oldOperand) && ts.isBinaryExpression(newOperand));
      assert.equal(oldOperand.left.getText(originalTree), newOperand.left.getText(currentTree));
      assert.equal(newOperand.right.getText(currentTree), 'null');
    }
    const oldWinner = property(before[index], 'winner', originalTree);
    const winner = ts.isAsExpression(oldWinner) ? oldWinner.expression : oldWinner;
    assert.equal(property(after[index], 'winner', currentTree).getText(currentTree), winner.getText(originalTree));
  }
});

test('every chart series, axis, legend, palette and persisted hidden-series identity is preserved', () => {
  assert.deepEqual(elements(currentTree, ['Line', 'Bar', 'XAxis', 'YAxis', 'CartesianGrid', 'ChartLegend', 'LineChart', 'BarChart']),
    elements(originalTree, ['Line', 'Bar', 'XAxis', 'YAxis', 'CartesianGrid', 'ChartLegend', 'LineChart', 'BarChart']));
  for (const key of ['fleet-compare-monthly-distance', 'fleet-compare-drives-per-month', 'analytics:fleet-compare']) {
    assert.ok(original.includes(key) && page.includes(key), key);
  }
});

test('all five sections remain mounted; source shells and retained paths are explicit', () => {
  assert.equal(elements(currentTree, ['Section']).length, 5);
  assert.equal(elements(currentTree, ['PageLayout']).length, 1);
  assert.ok(!page.includes('empty={!'));
  assert.ok(page.includes('if (isError && !state)'));
  assert.ok(page.includes('busy={vehiclesLoading}'));
  assert.ok(page.includes('vehiclesQuery.isSuccess && vehicleList.length < 2'));
  assert.ok(page.includes('mobilePresentation={{'));
  assert.ok(page.includes('allDetails: row =>'));
});
