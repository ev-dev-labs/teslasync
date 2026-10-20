/* Scoped source/pure checks only. No React mounting, typecheck, build or API calls. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');
const root = path.resolve(__dirname, '../../../../../..');
const ts = require(path.join(root, 'web/node_modules/typescript'));
const artifact = 'C:/Users/AtulM/.copilot/session-state/bba4960d-f516-4831-bda3-877640f907ce/files/parallel-charging-heatmap-page-live';
const pagePath = 'web/src/features/charging/pages/ChargingHeatmapPage.tsx';
const ownPath = 'web/src/features/charging/components/charging-heatmap-modernization';
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const old = fs.readFileSync(path.join(artifact, 'original', pagePath), 'utf8');
const current = read(pagePath);
const summary = read(`${ownPath}/ChargingHeatmapSummary.tsx`);
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const manifest = JSON.parse(fs.readFileSync(path.join(artifact, 'original-manifest.json'), 'utf8'));
for (const entry of manifest.files) {
  assert.equal(digest(fs.readFileSync(path.join(artifact, 'original', entry.path))), entry.sha256, `immutable original ${entry.path}`);
}
console.log(`PASS immutable original hashes: ${manifest.files.length}`);
const privateFiles = manifest.files.filter(entry => entry.path.includes('/components/charging-heatmap/'));
for (const entry of privateFiles) {
  assert.equal(digest(fs.readFileSync(path.join(root, entry.path))), entry.sha256, `readonly specialist ${entry.path}`);
}
console.log(`PASS byte-identical readonly specialists: ${privateFiles.length}`);
const hook = 'web/src/api/hooks/useCharging.ts';
assert.equal(digest(fs.readFileSync(path.join(root, hook))), manifest.files.find(x => x.path === hook).sha256);
assert.match(current, /useChargingSessionsPaginated\(vehicleId, \{ limit: 2000, start, end \}\)/);
assert.match(current, /persistKey: 'charging-heatmap.range',\s*defaultPresetId: 'all'/);
assert.match(read(hook), /request<ApiChargingSession\[\]>\(`\/charging\?\$\{params\}`/);
assert.match(read('internal/api/router.go'), /r\.Route\("\/charging",[\s\S]*?r\.Get\("\/", chargingHandler\.ListByVehicle\)/);
assert.match(read(hook), /queryKey: \['charging', vehicleId, start, end, limit, offset\] as const/);
assert.match(read(hook), /enabled: vehicleId !== null,\s*staleTime: STALE_TIMES.FAST,\s*select: safeArray/);
console.log('PASS exact existing hook bytes/operands/default range and /charging route');

const parse = (text, filename = 'source.tsx') => ts.createSourceFile(filename, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const ast = parse(current);
const originalAST = parse(old);
assert.equal(ast.parseDiagnostics.length, 0);
assert.equal(parse(summary).parseDiagnostics.length, 0);
assert.equal(parse(read(`${ownPath}/ChargingHeatmapModernization.test.tsx`)).parseDiagnostics.length, 0);
function find(node, predicate) {
  if (predicate(node)) return node;
  return ts.forEachChild(node, child => find(child, predicate));
}
function statsBody(tree) {
  const decl = find(tree, n => ts.isVariableDeclaration(n) && n.name.getText(tree) === 'stats');
  return decl.initializer.arguments[0].body.getText(tree);
}
function runStats(body, sessions) {
  return vm.runInNewContext(`(function(sessions) ${body})`)(sessions);
}
const sessions = [
  { started_at: '2026-01-05T10:00:00Z', ended_at: '2026-01-05T12:00:00Z', total_energy_added_wh: 12345, cost_decimal: 5 },
  { started_at: '2026-01-05T10:00:00Z', ended_at: null, total_energy_added_wh: 0, cost_decimal: null },
  { started_at: 'bad', ended_at: 'bad', total_energy_added_wh: null, cost_decimal: 0 },
  { started_at: '2026-01-05T10:00:00Z', ended_at: '2026-01-05T09:00:00Z', total_energy_added_wh: 100, cost_decimal: 2 },
];
for (const fixture of [[], sessions, [sessions[1]], [sessions[0]]]) {
  const previous = runStats(statsBody(originalAST), fixture);
  const next = runStats(statsBody(ast), fixture);
  if (!previous) assert.equal(next, null);
  else for (const key of Object.keys(previous)) assert.equal(next[key], previous[key], `original aggregate ${key}`);
}
const observed = runStats(statsBody(ast), sessions);
assert.equal(observed.durationCount, 1);
assert.equal(observed.energyCount, 3);
assert.equal(observed.costCount, 3);
console.log('PASS original aggregate operands/totals/positive-duration denominator, additive presence counts');

const summaryAST = parse(summary);
const metricDeclaration = find(summaryAST, n => ts.isVariableDeclaration(n) && n.name.getText(summaryAST) === 'metrics');
const metricSource = metricDeclaration.initializer.getText(summaryAST);
function metricsFor(stats, hasData) {
  const definition = ts.transpileModule(`function getMetrics(stats, state, t, unitPrefs, precision, locale) {
    const noMeasurements = 'missing', partialReason = 'partial';
    return ${metricSource};
  }`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return vm.runInNewContext(`(${definition.replace(/^function getMetrics/, 'function')})`)(
    stats, { hasData }, (_key, fallback) => fallback, {}, 2, 'en-US');
}
const measured = metricsFor(observed, true);
assert.deepEqual(Array.from(measured, item => item.metricId),
  ['charge.sessions', 'charge.energyAdded', 'charge.recordedCost', 'charge.avgDuration']);
assert.deepEqual(Array.from(measured, item => item.rawValue), [4, 12445, 7, 7200]);
const zeros = metricsFor(runStats(statsBody(ast), [{ ...sessions[1], cost_decimal: 0 }]), true);
assert.deepEqual(Array.from(zeros, item => item.rawValue), [1, 0, 0, null]);
assert.deepEqual(Array.from(metricsFor(null, true), item => item.rawValue), [0, null, null, null]);
assert.deepEqual(Array.from(metricsFor(null, false), item => item.rawValue), [null, null, null, null]);
assert.equal(metricsFor(observed, true)[2].context, 'partial');
console.log('PASS summary semantic metric IDs, raw SI totals, partial metadata, actual zero vs missing');

// Compare complete chart JSX subtrees, not just individual data keys.
function chartTrees(tree) {
  const result = [];
  function visit(node) {
    if (ts.isJsxElement(node) && node.openingElement.tagName.getText(tree) === 'EmbeddedChart') result.push(node.getText(tree));
    ts.forEachChild(node, visit);
  }
  visit(tree);
  return result;
}
assert.deepEqual(chartTrees(ast), chartTrees(originalAST));
assert.equal(chartTrees(ast).length, 2);
for (const expression of ['buildGrid(sessions)', 'deriveInsights(model)', 'aggregateByDayOfWeek(model, DAYS)',
  'aggregateLocations(sessions,', '<HeatmapGrid model={model} formatEnergy={formatEnergy} />',
  'Math.max(stats?.count ?? 0, 1)', 'charging-heatmap-when', 'charging-heatmap-breakdowns',
  'favoriteValue', 'favoriteSessions', 'busiestDayCount', 'busiestHourCount', 'weekdayCount', 'weekendCount']) {
  assert.ok(old.includes(expression) && current.includes(expression), `retained ${expression}`);
}
assert.equal((current.match(/<LayoutCard\b/g) ?? []).length, 4);
assert.equal((old.match(/<GlassPanel\b/g) ?? []).length, 4);
assert.equal((current.match(/<CardGrid\b/g) ?? []).length, 2);
assert.match(current, /useDataState\(query, \{ provenance: 'historical' \}\)/);
assert.match(current, /const isError = state\.fatalError != null/);
assert.match(current, /const isLoading = !state\.hasData && query\.isLoading/);
assert.match(current, /<StaleRefreshWarning state=\{state\}/);
assert.match(current, /!state\.hasData && state\.isRefreshBlocked/);
console.log('PASS four shells, two byte-identical chart subtrees, heatmap/insights, retained/fatal/paused source wiring');

function loadPure(rel) {
  const module = { exports: {} };
  const output = ts.transpileModule(read(rel), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(output, { exports: module.exports, module, Date, Error, Number, Math, JSON });
  return module.exports;
}
const { deriveDataState } = loadPure('web/src/api/dataState.ts');
assert.equal(deriveDataState({ data: undefined, isLoading: true }).status, 'initial');
assert.ok(deriveDataState({ data: undefined, error: new Error('down') }).fatalError);
const failed = deriveDataState({ data: sessions, error: new Error('refresh') });
assert.equal(failed.data, sessions);
assert.equal(failed.fatalError, null);
assert.ok(failed.refreshError);
const paused = deriveDataState({ data: sessions, fetchStatus: 'paused' });
assert.equal(paused.data, sessions);
assert.equal(paused.isRefreshBlocked, true);
assert.equal(deriveDataState({ data: [] }).hasData, true);
const heatmap = loadPure('web/src/features/charging/components/charging-heatmap/heatmapData.ts');
const grid = heatmap.buildGrid(sessions);
assert.equal(grid.grid.length, 7);
assert.ok(grid.grid.every(row => row.length === 24));
assert.equal(grid.grid.flat().reduce((sum, cell) => sum + cell.count, 0), 3);
assert.equal(grid.grid.flat().reduce((sum, cell) => sum + cell.totalEnergyWh, 0), 12445);
assert.equal(heatmap.HEAT_LEGEND.length, 5);
assert.equal(heatmap.aggregateByDayOfWeek(grid, ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']).length, 7);
console.log('PASS pure shared data-state transitions and specialist 7x24 grid, all cells, energy and legend');

const production = [current, summary, read(`${ownPath}/index.ts`)].join('\n');
const violations = {
  inlineStyles: (production.match(/style=\{\{/g) ?? []).length,
  rawControls: (production.match(/<(?:button|input|textarea|select|table)\b/g) ?? []).length,
  directLibraries: (production.match(/from ['"](?:recharts|react-leaflet|framer-motion)['"]/g) ?? []).length,
  camelCaseVehicleParams: (production.match(/vehicleId=/g) ?? []).length,
  secondEngines: (production.match(/\b(?:ResizeObserver|fetch|useEffect|useState|localStorage)\b/g) ?? []).length,
};
assert.deepEqual(violations, { inlineStyles: 0, rawControls: 0, directLibraries: 0, camelCaseVehicleParams: 0, secondEngines: 0 });
const lines = text => text.split(/\r?\n/).length;
const originalLines = lines(old), productionLines = lines(production);
assert.ok(productionLines >= originalLines * 0.7);
console.log(JSON.stringify({ violations, originalLines, productionLines, ratio: productionLines / originalLines,
  originalGlassPanelChartContainerMatchingLines: old.split(/\r?\n/).filter(line => /GlassPanel|ChartContainer/.test(line)).length,
  currentGlassPanelChartContainerMatchingLines: current.split(/\r?\n/).filter(line => /GlassPanel|ChartContainer/.test(line)).length,
  semanticPanelShells: 4, embeddedChartFrames: 2 }, null, 2));
console.log('PASS scoped source/pure checks; runtime/TypeScript/build/browser acceptance NOT ESTABLISHED');
