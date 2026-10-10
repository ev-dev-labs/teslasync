/* Node-only source/pure checks. Not a Vitest discovery file or runtime acceptance. */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const ts = require('typescript');
const repo = path.resolve(__dirname, '../../../../../..');
const page = path.join(repo, 'web/src/features/battery/pages/BatteryCellsPage.tsx');
const originalPath = 'C:\\Users\\AtulM\\.copilot\\session-state\\bba4960d-f516-4831-bda3-877640f907ce\\files\\parallel-battery-cells-page-live\\original-current\\BatteryCellsPage.tsx';
const original = fs.readFileSync(originalPath, 'utf8');
const current = fs.readFileSync(page, 'utf8');
const stats = fs.readFileSync(path.join(__dirname, 'BatteryCellsStats.tsx'), 'utf8');
const closure = `${current}\n${stats}`;
const parse = text => ts.createSourceFile('fixture.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function walk(node, callback) { callback(node); ts.forEachChild(node, child => walk(child, callback)); }
function elements(text, names) {
  const result = [];
  walk(parse(text), node => {
    if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && names.includes(node.tagName.getText())) {
      const attrs = {};
      node.attributes.properties.forEach(prop => {
        if (ts.isJsxAttribute(prop)) attrs[prop.name.getText()] = prop.initializer?.getText();
      });
      result.push({ tag: node.tagName.getText(), attrs });
    }
  });
  return result;
}
for (const file of [page, path.join(__dirname, 'BatteryCellsStats.tsx'), path.join(__dirname, 'BatteryCellsModernization.test.tsx')]) {
  const source = fs.readFileSync(file, 'utf8');
  assert.deepEqual(parse(source).parseDiagnostics, [], `TSX parse failed: ${file}`);
}
console.log('PASS: all owned TSX parses without syntax diagnostics (not typechecking).');
const sections = text => [...text.matchAll(/\{\/\* (\d) —/g)].map(match => match[1]);
assert.deepEqual(sections(current), sections(original));
assert.equal(sections(current).length, 8);
console.log('PASS: all eight original numbered sections retained.');
const series = text => elements(text, ['Line', 'Bar', 'Area']).map(({ tag, attrs }) => ({ tag, key: attrs.dataKey, name: attrs.name }));
assert.deepEqual(series(current), series(original));
console.log(`PASS: all ${series(original).length} series and localized names retained, in source order.`);
const embedded = text => elements(text, ['EmbeddedChart']).map(({ attrs }) => ({
  title: attrs.title, ariaLabel: attrs.ariaLabel, key: attrs.chartKey, fluid: attrs.fluid,
  height: attrs.height, mobileHeight: attrs.mobileHeight, data: attrs.data, columns: attrs.dataColumns,
}));
assert.deepEqual(embedded(current), embedded(original));
console.log('PASS: five embedded chart datasets, accessible columns, dimensions and legend key unchanged.');
const annotated = text => elements(text, ['ChartContainer']).map(({ attrs }) => ({
  title: attrs.title, aria: attrs.ariaLabel, annotations: attrs.annotations,
  fullscreen: attrs.fullscreen, exportable: attrs.exportable, exportData: attrs.exportData,
}));
assert.deepEqual(annotated(current), annotated(original));
console.log('PASS: real annotated ChartContainer retained; export default enabled, fullscreen omitted/disabled, CSV omitted.');
const keys = text => new Set([...text.matchAll(/t\('([^']+)'/g)].map(match => match[1]));
for (const key of keys(original)) assert.ok(keys(closure).has(key), `Dropped original localization/metric/section: ${key}`);
console.log('PASS: all original localized metric, section, action and preference labels retained in production closure.');
assert.match(current, /const batteryQuery = useBatteryCells\(activeId\)/);
assert.match(current, /tableId="battery:cells"/);
assert.match(current, /mobileColumns=\{\['cell_number', 'voltage', 'delta_from_avg', 'status'\]\}/);
assert.match(current, /mobilePresentation=\{/);
assert.match(current, /useSortToggle\('cell_number', 'asc'\)/);
assert.match(current, /annotations=\{\{ vehicleId, scope: 'battery', chartId: 'battery-cells-spread-trend' \}\}/);
assert.match(current, /!hidden && renderAnnotationLines/);
assert.match(current, /useDataState\(batteryQuery/);
assert.match(current, /const data = batteryState\.data;/);
assert.doesNotMatch(current, /(?:r\.voltage|cell\.voltage|data\?\.pack_voltage|data\?\.imbalance_mv) \?\? 0/);
assert.match(stats, /formatTemperatureDelta\(spread, unitPrefs\)/);
const oldLines = original.split(/\r?\n/).length;
const newLines = closure.split(/\r?\n/).length;
assert.ok(newLines >= oldLines * 0.7);
console.log(`PASS: production closure ${newLines} lines / original ${oldLines} = ${(newLines / oldLines * 100).toFixed(1)}% (tests/checks excluded).`);
const hook = fs.readFileSync(path.join(repo, 'web/src/api/hooks/useAnalytics.ts'), 'utf8');
const router = fs.readFileSync(path.join(repo, 'internal/api/router.go'), 'utf8');
assert.match(hook, /request<BatteryCellData>\(`\/analytics\/battery-cells\?vehicle_id=/);
assert.match(router, /r\.Get\("\/analytics\/battery-cells", batteryCellsHandler\.Get\)/);
assert.match(router, /r\.Route\("\/annotations"/);
for (const verb of ['Get', 'Post', 'Delete']) assert.match(router, new RegExp(`r\\.${verb}\\("[^"]*", chartAnnotationHandler\\.`));
console.log('PASS: battery GET and existing annotation read/create/delete hooks have matching backend routes.');
function pureExports(text) {
  const functions = [];
  walk(parse(text), node => {
    if (ts.isFunctionDeclaration(node) && ['cellColor', 'buildHistogram'].includes(node.name?.text)) functions.push(node.getText());
  });
  const js = ts.transpileModule(functions.join('\n').replaceAll('export function', 'function'), {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
  }).outputText;
  return new Function('knownNumber', 'fmtScientificNumber', `${js}; return { cellColor, buildHistogram };`)(
    value => typeof value === 'number' && Number.isFinite(value) ? value : null,
    (value, precision) => Number(value).toFixed(precision),
  );
}
const before = pureExports(original), after = pureExports(current);
for (const [voltage, average] of [[3.9, 3.9], [3.91, 3.9], [3.93, 3.9]]) assert.equal(after.cellColor(voltage, average), before.cellColor(voltage, average));
for (const voltages of [[], [3.9], [3.9, 3.9], [3.85, 3.9, 3.95], [0, 0.005, 0.015]]) {
  const cells = voltages.map((voltage, index) => ({ cell_number: index + 1, voltage }));
  assert.deepEqual(after.buildHistogram(cells), before.buildHistogram(cells));
}
assert.deepEqual(after.buildHistogram([{ voltage: null }, { voltage: NaN }]), []);
assert.equal(after.buildHistogram([{ voltage: 0 }, { voltage: null }]).reduce((sum, bucket) => sum + bucket.count, 0), 1);
console.log('PASS: pure heatmap threshold colors and histogram valid-data buckets unchanged; unknown voltage not binned as zero.');
