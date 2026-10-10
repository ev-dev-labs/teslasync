/* Scoped Node guard, not a Vitest-discovered suite. No app mount or network. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '../../../../../..');
const pagePath = path.resolve(__dirname, '../../pages/EnergyFlowPage.tsx');
const page = fs.readFileSync(pagePath, 'utf8');
const ast = ts.createSourceFile(pagePath, page, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
assert.equal(ast.parseDiagnostics.length, 0, 'Page must parse without diagnostics');

function evaluate(source) {
  const helperModule = { exports: {} };
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function('module', 'exports', js)(helperModule, helperModule.exports);
  return helperModule.exports;
}
// Run the canonical converters, not copied conversion factors. Date formatting
// is intentionally isolated; these receipts cover numeric helpers, not locale dates.
const units = evaluate(fs.readFileSync(path.join(root, 'web/src/lib/unitConversion.ts'), 'utf8'));
const names = ['scaleEfficiency', 'efficiencyRating', 'computeChargePower', 'buildDailyChartData', 'buildEfficiencyChartData'];
const helpers = ast.statements.filter(node => ts.isFunctionDeclaration(node) && names.includes(node.name?.text));
assert.equal(helpers.length, names.length, 'All original exported helpers remain');
const helperModule = { exports: {} };
const js = ts.transpileModule(helpers.map(node => node.getText(ast)).join('\n'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText;
new Function('module', 'exports', 'convertDistanceFromSI', 'convertEnergyFromSI', 'formatDateShort', js)(
  helperModule, helperModule.exports, units.convertDistanceFromSI, units.convertEnergyFromSI, value => value,
);
const h = helperModule.exports;
assert.equal(h.scaleEfficiency(0.18, 'km'), 180);
assert.equal(h.scaleEfficiency(0.18, 'mi'), 290);
assert.equal(h.scaleEfficiency(null, 'km'), null);
assert.equal(h.scaleEfficiency(0, 'km'), 0);
assert.equal(h.computeChargePower(undefined), null);
assert.equal(h.computeChargePower({ dc_charging_power: 7, ac_charging_power: null }), null);
assert.equal(h.computeChargePower({ dc_charging_power: 7, ac_charging_power: 3 }), 10);
assert.equal(h.computeChargePower({ dc_charging_power: 0, ac_charging_power: 0 }), 0);
for (const [unit, excellent, good] of [['km', 150, 200], ['mi', 240, 320]]) {
  assert.equal(h.efficiencyRating(excellent - 1, unit), 'excellent');
  assert.equal(h.efficiencyRating(excellent, unit), 'good');
  assert.equal(h.efficiencyRating(good, unit), 'high');
  assert.equal(h.efficiencyRating(null, unit), 'none');
}
const rows = [
  { date: '2026-10-01', energy_wh: 12000, distance_m: 100000, efficiency_wh_per_m: 0.12 },
  { date: '2026-10-02', energy_wh: null, distance_m: null, efficiency_wh_per_m: null },
  { date: '2026-10-03', energy_wh: 0, distance_m: 0, efficiency_wh_per_m: 0 },
];
assert.deepEqual(h.buildDailyChartData(rows, 'km').map(({ energy, distance }) => [energy, distance]),
  [[12, 100], [null, null], [0, 0]]);
assert.equal(h.buildDailyChartData(rows, 'mi').length, rows.length);
assert.equal(h.buildEfficiencyChartData(rows, 'km').length, 1, 'Original positive-efficiency eligibility retained');
assert.equal(h.buildEfficiencyChartData(rows, 'mi')[0].efficiency, 193);
console.log('PASS pure helpers: metric/imperial SI, missing vs zero, charge operands, rating boundaries, complete daily rows');
const trust = evaluate(fs.readFileSync(path.join(root, 'web/src/api/dataState.ts'), 'utf8'));
const failure = new Error('refresh fixture');
const retained = trust.deriveDataState({ data: rows, error: failure, isError: true });
assert.equal(retained.data, rows);
assert.equal(retained.status, 'stale');
assert.equal(retained.fatalError, null);
assert.equal(retained.refreshError, failure);
const paused = trust.deriveDataState({ data: rows, fetchStatus: 'paused' });
assert.equal(paused.data, rows);
assert.equal(paused.isRefreshBlocked, true);
assert.equal(paused.status, 'stale');
const initialFailure = trust.deriveDataState({ error: failure });
assert.equal(initialFailure.hasData, false);
assert.equal(initialFailure.fatalError, failure);
assert.equal(trust.deriveDataState({ fetchStatus: 'paused' }).isRefreshBlocked, true);
console.log('PASS actual shared data-state engine: retained refresh errors, retained paused, initial fatal and initial paused');

for (const key of ['energy-flow-daily-energy-usage', 'energy-flow-daily-distance', 'energy-flow-daily-efficiency',
  'battery:energy-flow-history', 'energy-flow.range']) assert.ok(page.includes(key), `Preserve ${key}`);
assert.equal((page.match(/<ChartContainer\b/g) ?? []).length, 3);
assert.equal((page.match(/exportable=\{false\} fullscreen=\{false\}/g) ?? []).length, 3);
assert.equal((page.match(/<LayoutCard\b/g) ?? []).length, 8);
assert.equal((page.match(/<FlowNode\b/g) ?? []).length, 3);
assert.equal((page.match(/<FlowConnector\b/g) ?? []).length, 2);
assert.ok(page.includes('useEnergyStats(activeId, days)'));
assert.ok(page.includes('useEnergyFlow(activeId)'));
assert.ok(page.includes('86_400_000') && page.includes('Math.round((endMs - startMs)'));
assert.ok(page.includes('mobilePresentation={{'));
assert.ok(page.includes('enableValueFilters') && page.includes('pagination'));
assert.ok(!/<(?:button|input|textarea|select|table)\b/.test(page));
assert.ok(!/from ['"](?:recharts|react-leaflet|framer-motion)['"]/.test(page));
const router = fs.readFileSync(path.join(root, 'internal/api/router.go'), 'utf8');
assert.ok(router.includes('r.Get("/energy", energyHandler.Stats)'));
assert.ok(router.includes('r.Get("/energy/flow", energyFlowHandler.Get)'));
console.log('PASS source contracts: 8 card shells, 3 chart series/IDs, 3 nodes/2 connectors, table controllers, query operands/routes');
if (process.argv[2]) {
  const manifest = JSON.parse(fs.readFileSync(path.join(process.argv[2], 'originals-manifest.json'), 'utf8'));
  const original = manifest.files.find(row => row.path.endsWith('/EnergyFlowPage.tsx'));
  const oldPage = fs.readFileSync(original.original, 'utf8');
  const oldAst = ts.createSourceFile(original.original, oldPage, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  function chartContracts(tree) {
    const contracts = [];
    const chartNames = ['AreaChart', 'BarChart', 'Area', 'Bar', 'XAxis', 'YAxis', 'Tooltip', 'ResponsiveContainer', 'ChartGradient'];
    function visit(node) {
      if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node))
        && chartNames.includes(node.tagName.getText(tree))) {
        contracts.push(node.getText(tree).replace(/\s+/g, ' '));
      }
      ts.forEachChild(node, visit);
    }
    visit(tree);
    return contracts;
  }
  assert.deepEqual(chartContracts(ast), chartContracts(oldAst),
    'All original chart engines, series, axes, tooltips, gradients, colors, margins and animations remain exact');
  console.log('PASS chart AST equivalence: complete original series/axes/tooltips/responsive/palette/animation props');
  assert.ok(page.split('\n').length >= oldPage.split('\n').length * 0.7);
  for (const dependency of ['web/src/api/hooks/useEnergy.ts', 'web/src/types/energy.ts', 'internal/api/router.go']) {
    const before = manifest.files.find(row => row.path === dependency);
    const now = crypto.createHash('sha256').update(fs.readFileSync(path.join(root, dependency))).digest('hex').toUpperCase();
    assert.equal(now, before.sha256, `Read-only dependency ${dependency}`);
  }
  console.log(`PASS immutable mapping: page ${oldPage.split('\n').length} → ${page.split('\n').length} lines; hooks/types/router byte-preserved`);
}
console.log('Runtime/browser/full-app acceptance: NOTRUN');
