/* Scoped Node/pure check, not a Vitest test and not application acceptance. */
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const root = path.resolve(__dirname, '../../../../../..');
const page = 'web/src/features/battery/pages/PackCapacityPage.tsx';
const privateDir = 'web/src/features/battery/components/pack-capacity';
const ownedDir = 'web/src/features/battery/components/pack-capacity-modernization';
const artifacts = process.argv[2] || 'C:/Users/AtulM/.copilot/session-state/bba4960d-f516-4831-bda3-877640f907ce/files/parallel-pack-capacity-page-live';
const originalRoot = path.join(artifacts, 'originals');
const read = (relative, base = root) => fs.readFileSync(path.join(base, relative), 'utf8');
const hash = (relative, base = root) => crypto.createHash('sha256')
  .update(fs.readFileSync(path.join(base, relative))).digest('hex');
const production = fs.readdirSync(path.join(root, ownedDir))
  .filter(name => /\.tsx?$/.test(name) && !name.includes('.test.'))
  .map(name => `${ownedDir}/${name}`);
const owned = [page, ...fs.readdirSync(path.join(root, ownedDir)).map(name => `${ownedDir}/${name}`)].sort();

function ast(relative, base = root) {
  return ts.createSourceFile(relative, read(relative, base), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}
function visit(node, callback) {
  callback(node);
  ts.forEachChild(node, child => visit(child, callback));
}
function compact(node, source) {
  return node.getText(source).replace(/\s+/g, '');
}
function calls(relative, name, base = root) {
  const source = ast(relative, base);
  const values = [];
  visit(source, node => {
    if (ts.isCallExpression(node) && node.expression.getText(source) === name) values.push(compact(node, source));
  });
  return values;
}
function translationKeys(relative, base = root) {
  const keys = [];
  visit(ast(relative, base), node => {
    if (ts.isCallExpression(node) && node.expression.getText() === 't'
      && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) keys.push(node.arguments[0].text);
  });
  return [...new Set(keys)].sort();
}
function inventory(relative, base = root) {
  const source = ast(relative, base);
  const jsx = [];
  const operands = new Set();
  visit(source, node => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(source);
      const props = Object.fromEntries(node.attributes.properties
        .filter(ts.isJsxAttribute).map(attribute => [attribute.name.getText(source),
          attribute.initializer?.getText(source) ?? true]));
      jsx.push({ tag, props });
    }
    if (ts.isPropertyAccessExpression(node)) {
      const value = node.getText(source);
      if (/^(result|accounting|coverage|support|fit|point|row|component)\./.test(value)) operands.add(value);
    }
  });
  return { path: relative, sha256: hash(relative, base), translations: translationKeys(relative, base),
    operands: [...operands].sort(), jsx };
}
function pure(relative, base = root) {
  const result = ts.transpileModule(read(relative, base), {
    fileName: relative,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    reportDiagnostics: true,
  });
  assert.equal(result.diagnostics?.length ?? 0, 0, `syntax diagnostics: ${relative}`);
  // Share Error's constructor so the pure harness has the production realm's
  // instanceof semantics. Keep the strict error-identity assertions below.
  const context = { exports: {}, Error, require: name => { throw new Error(`Unexpected pure dependency ${name}`); } };
  vm.runInNewContext(result.outputText, context, { filename: relative });
  return context.exports;
}

// Immutable originals come from CURRENT DIRTY files, never git/HEAD.
const privateFiles = fs.readdirSync(path.join(originalRoot, privateDir)).map(name => `${privateDir}/${name}`);
for (const relative of privateFiles) assert.equal(hash(relative), hash(relative, originalRoot), `readonly private changed: ${relative}`);
const sciencePath = 'web/src/features/battery/lib/packCapacity.ts';
assert.equal(hash(sciencePath), hash(sciencePath, originalRoot));
const hookPath = 'web/src/api/hooks/useCharging.ts';
assert.equal(hash(hookPath), hash(hookPath, originalRoot), 'history hook bytes changed');
assert.deepEqual(calls(page, 'useChargingHistory'), calls(page, 'useChargingHistory', originalRoot));
assert.deepEqual(calls(page, 'analyzePackCapacity'), calls(page, 'analyzePackCapacity', originalRoot));
assert.deepEqual(calls(page, 'useState'), calls(page, 'useState', originalRoot), 'clock/model defaults changed');
const router = read('internal/api/router.go');
assert.match(router, /r\.Route\("\/charging",[\s\S]*?r\.Get\("\/", chargingHandler\.ListByVehicle\)/);
assert.match(read(hookPath), /request<ChargingSession\[\]>\(\s*`\/charging\?vehicle_id=\$\{encodeURIComponent\(String\(vehicleId\)\)\}&limit=\$\{boundedLimit\}`,\s*\{ signal \}/);

const replacements = {
  PackCapacityKpiBand: 'PackCapacitySummary',
  PackCapacityDirectory: 'PackCapacityMeasurementDirectory',
  PackCapacityAccounting: 'PackCapacityRowAccounting',
};
for (const [before, after] of Object.entries(replacements)) {
  const oldPath = `${privateDir}/${before}.tsx`;
  const newPath = `${ownedDir}/${after}.tsx`;
  const keys = translationKeys(newPath);
  for (const key of translationKeys(oldPath, originalRoot)) assert(keys.includes(key), `lost translation/meaning: ${key}`);
}
function sectionNames(relative, base) {
  return inventory(relative, base).jsx.map(entry => entry.tag)
    .filter(tag => /^PackCapacity/.test(tag) && !['PackCapacityPlacement', 'PackCapacitySourceNotice'].includes(tag));
}
const oldSections = sectionNames(page, originalRoot);
const newSections = sectionNames(page, root);
assert.equal(oldSections.length, 14);
assert.deepEqual(newSections, oldSections.map(tag => replacements[tag] ?? tag), 'section order/count changed');
for (const [before, after] of Object.entries(replacements)) {
  const oldSection = inventory(`${privateDir}/${before}.tsx`, originalRoot).jsx.find(entry => entry.tag === 'section');
  const newSection = inventory(`${ownedDir}/${after}.tsx`).jsx.find(entry => entry.tag === 'section');
  assert.equal(newSection.props['data-testid'], oldSection.props['data-testid'], 'section test ID changed');
}
const oldDirectory = inventory(`${privateDir}/PackCapacityDirectory.tsx`, originalRoot);
const newDirectory = inventory(`${ownedDir}/PackCapacityMeasurementDirectory.tsx`);
const oldAccounting = inventory(`${privateDir}/PackCapacityAccounting.tsx`, originalRoot);
const newAccounting = inventory(`${ownedDir}/PackCapacityRowAccounting.tsx`);
for (const [before, after] of [[oldDirectory, newDirectory], [oldAccounting, newAccounting]]) {
  const a = before.jsx.find(entry => entry.tag === 'DataTable').props;
  const b = after.jsx.find(entry => entry.tag === 'DataTable').props;
  for (const key of ['tableId', 'enableValueFilters', 'data', 'columns']) {
    assert.equal(b[key], a[key], `table contract changed: ${key}`);
  }
  assert(b.mobilePresentation, 'mobile presentation not adopted');
  assert.equal(b.variant, '"embedded"');
  // This authorized display-only delta fixes the old tablet hidden-field gap.
  // Validate the COMPLETE source column list, not merely the old allow-list.
  const keys = before === oldDirectory
    ? ['completed', 'window', 'energy', 'raw', 'filtered', 'sigma', 'gain', 'innovation', 'location']
    : ['category', 'count', 'share'];
  const allowed = [...b.mobileColumns.matchAll(/'([^']+)'/g)].map(match => match[1]);
  assert.deepEqual(allowed, keys, 'tablet fallback lost a source column');
}
const violations = Object.fromEntries([
  ['inlineStyles', /style=\{\{/g],
  ['rawControls', /<(?:button|input|textarea|select|table)\b/g],
  ['directChartMapMotionImports', /from\s+['"](?:recharts|react-leaflet|framer-motion)['"]/g],
  ['camelCaseVehicleQuery', /vehicleId=/g],
  ['directNetwork', /\bfetch\(|new\s+EventSource/g],
].map(([name, pattern]) => [name, [page, ...production].reduce(
  (count, relative) => count + [...read(relative).matchAll(pattern)].length, 0,
)]));
for (const [name, count] of Object.entries(violations)) assert.equal(count, 0, name);

// Syntax only: explicitly NOT a semantic TypeScript/project check.
for (const relative of [page, ...production, `${ownedDir}/PackCapacityModernization.test.tsx`]) {
  const result = ts.transpileModule(read(relative), { fileName: relative, reportDiagnostics: true,
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } });
  assert.equal(result.diagnostics?.length ?? 0, 0, `syntax diagnostics ${relative}`);
}

const { deriveDataState } = pure('web/src/api/dataState.ts');
const { packCapacitySourceState } = pure(`${ownedDir}/packCapacitySourceState.ts`);
const rows = [{ id: '1' }];
let retries = 0;
const refetch = () => { retries += 1; };
const source = overrides => deriveDataState({ refetch, ...overrides }, { now: () => 100 });
let state = packCapacitySourceState(source({ isPending: true, isFetching: true }), true, true);
assert.equal(state.isLoading, true);
assert.equal(state.isResolved, false);
state = packCapacitySourceState(source({ isPending: true, fetchStatus: 'idle' }), true, false);
assert.equal(state.isLoading, false, 'idle pending must not gain a spinner');
state = packCapacitySourceState(source({ isPending: true, fetchStatus: 'paused' }), true, true);
assert.equal(state.isLoading, false);
assert.equal(state.isResolved, false);
const error = new Error('failure');
state = packCapacitySourceState(source({ error, isError: true }), true, false);
assert.equal(state.error, error);
assert.equal(state.isResolved, true);
state.onRetry();
assert.equal(retries, 1);
const retained = source({ data: rows, error, isError: true });
assert.equal(retained.data, rows);
state = packCapacitySourceState(retained, true, true);
assert.equal(state.error, null);
assert.equal(state.refreshError, error);
assert.equal(state.isLoading, false);
assert.equal(state.isResolved, true);
state = packCapacitySourceState(source({ data: [], isSuccess: true }), true, false);
assert.equal(state.isResolved, true, 'empty success must resolve');
state = packCapacitySourceState(source({ data: rows, fetchStatus: 'paused' }), true, false);
assert.equal(state.isResolved, true);
assert.equal(state.error, null);
state = packCapacitySourceState(retained, false, true);
assert.equal(state.isResolved, false);
assert.equal(state.error, null);
assert.equal(state.refreshError, null);

// Pure science equivalence using original/current modules and unchanged operands.
const oldScience = pure(sciencePath, originalRoot);
const newScience = pure(sciencePath);
const now = Date.parse('2026-08-08T12:00:00Z');
const sessions = Array.from({ length: 14 }, (_, index) => {
  const end = new Date(Date.UTC(2025, 4 + index, 15, 20)).toISOString();
  const start = new Date(Date.parse(end) - 7200000).toISOString();
  return { id: String(index + 1), vehicle_id: '7', charger_type: 'AC',
    start_soc_pct: 20, end_soc_pct: 60, total_energy_added_wh: (76000 - index * 120) * 0.4,
    started_at: start, ended_at: end, start_ts: start, startedAt: start, duration_min: 120 };
});
let scienceCases = 0;
for (const timeZone of ['America/Los_Angeles', 'UTC']) {
  for (const minSocWindowPct of newScience.CAPACITY_SOC_WINDOW_OPTIONS) {
    for (const processNoiseWhPerSqrtDay of newScience.CAPACITY_PROCESS_NOISE_OPTIONS) {
      const options = { minSocWindowPct, processNoiseWhPerSqrtDay, historyLimit: 1000 };
      const a = oldScience.analyzePackCapacity(sessions, now, timeZone, options);
      const b = newScience.analyzePackCapacity(sessions, now, timeZone, options);
      assert.equal(JSON.stringify(b), JSON.stringify(a));
      assert.equal(b.accounting.returnedRows, b.accounting.includedRows + b.accounting.excludedRows);
      scienceCases += 1;
    }
  }
}
const originalLines = read(page, originalRoot).split('\n').length;
const currentLines = read(page).split('\n').length;
assert(currentLines >= originalLines * 0.7, 'page closure below 70%');
const receipts = {
  status: 'SCOPED_SOURCE_AND_PURE_PASS', runtime: 'NOT_RUN', semanticTypeScript: 'NOT_RUN',
  violations, sectionCount: oldSections.length, originalLines, currentLines, scienceCases,
  sectionMapping: oldSections.map((name, index) => ({ original: name, current: newSections[index] })),
  ownedHashes: owned.map(relative => ({ path: relative, sha256: hash(relative) })),
  immutablePrivateFiles: privateFiles.length,
};
if (process.argv.includes('--inventory')) {
  receipts.inventory = {
    original: privateFiles.filter(file => file.endsWith('.tsx')).map(file => inventory(file, originalRoot)),
    current: [
      ...privateFiles.filter(file => file.endsWith('.tsx') && !Object.keys(replacements).some(name => file.endsWith(`/${name}.tsx`))),
      ...Object.values(replacements).map(name => `${ownedDir}/${name}.tsx`),
    ].map(file => inventory(file)),
    query: { original: calls(page, 'useChargingHistory', originalRoot), current: calls(page, 'useChargingHistory') },
  };
}
function snapshotFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(directory, entry.name);
    return entry.isDirectory() ? snapshotFiles(full) : [path.relative(originalRoot, full).replaceAll('\\', '/')];
  });
}
receipts.originalHashes = snapshotFiles(originalRoot).map(relative => ({
  path: relative, originalSha256: hash(relative, originalRoot), currentSha256: hash(relative),
  identical: hash(relative) === hash(relative, originalRoot),
}));
console.log(JSON.stringify(receipts, null, 2));
