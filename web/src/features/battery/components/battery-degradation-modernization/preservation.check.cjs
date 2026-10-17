/* Source/pure checks only. Not a mounted page, browser, or application acceptance suite. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');
const ts = require('typescript');

const repo = path.resolve(__dirname, '../../../../../..');
const artifact = process.argv[2];
assert.ok(artifact, 'Pass the immutable artifact root');
const pagePath = 'web/src/features/battery/pages/BatteryDegradationPage.tsx';
const read = file => fs.readFileSync(file, 'utf8');
const original = read(path.join(artifact, 'original', pagePath));
const current = read(path.join(repo, pagePath));
const newDir = __dirname;
const production = fs.readdirSync(newDir).filter(file => /\.(ts|tsx)$/.test(file) && !file.includes('.test.'));
const closure = current + production.map(file => read(path.join(newDir, file))).join('\n');
const parse = (name, source) => ts.createSourceFile(name, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const oldAst = parse('original.tsx', original);
const newAst = parse('current.tsx', current);
const printer = ts.createPrinter({ removeComments: true });
const printed = (node, ast) => printer.printNode(ts.EmitHint.Unspecified, node, ast);
function collect(ast, predicate) {
  const nodes = [];
  function walk(node) {
    if (predicate(node)) nodes.push(node);
    ts.forEachChild(node, walk);
  }
  walk(ast);
  return nodes;
}
const tag = node => node.tagName?.getText();
for (const component of ['Area', 'Line', 'XAxis', 'ReferenceLine', 'ChartBrush', 'ChartLegend']) {
  const get = ast => collect(ast, node => ts.isJsxSelfClosingElement(node) && tag(node) === component)
    .map(node => printed(node, ast));
  assert.deepEqual(get(newAst), get(oldAst), `${component} series/axes/defaults must remain identical`);
}
for (const name of ['sohColor', 'scoreVariant', 'riskScoreColor', 'riskBarHex', 'riskBadgeVariant', 'riskFactorIcon']) {
  const get = ast => collect(ast, node => ts.isFunctionDeclaration(node) && node.name?.text === name)
    .map(node => printed(node, ast));
  assert.deepEqual(get(newAst), get(oldAst), `Scientific classification ${name} changed`);
}
const projection = ast => collect(ast, node => ts.isVariableDeclaration(node) && node.name.getText() === 'projectionChartData')
  .map(node => printed(node, ast));
assert.deepEqual(projection(newAst), projection(oldAst), 'Forecast assembly, continuity and CI math changed');
const translations = ast => collect(ast, node => ts.isCallExpression(node)
  && node.expression.getText() === 't' && ts.isStringLiteral(node.arguments[0]))
  .map(node => node.arguments[0].text);
const closureKeys = new Set(translations(parse('closure.tsx', closure)));
for (const key of translations(oldAst)) assert.ok(closureKeys.has(key), `Original translated content lost: ${key}`);
for (const hook of ['useBatteryHealthAnalytics', 'useSelectedVehicle', 'useHiddenSeries']) {
  const get = ast => collect(ast, node => ts.isCallExpression(node) && node.expression.getText() === hook)
    .map(node => printed(node, ast));
  assert.deepEqual(get(newAst), get(oldAst), `${hook} operands or preference keys changed`);
}
for (const field of ['date', 'odometer_m', 'soh_pct', 'capacity_wh', 'range_m']) {
  assert.ok(current.includes(`key: '${field}'`), `Missing table column ${field}`);
  assert.ok(current.includes(`${field}: '`), `Missing mobile role ${field}`);
}
for (const identity of ['battery:degradation-history', 'battery-degradation-trend', 'battery-degradation-range-loss', "guidanceId=\"battery.degradation\""]) {
  assert.ok(current.includes(identity), `Persistence/guidance identity lost: ${identity}`);
}
const sectionCount = text => (text.match(/\/\* ── [1-6] ·/g) ?? []).length;
assert.equal(sectionCount(original), 6);
assert.equal(sectionCount(current), 6);
assert.ok(!closure.includes('data && <'), 'Whole-page data gating');
assert.ok(!current.includes('healthQuery.error'), 'Retained data must not be replaced by refresh errors');
assert.ok(current.includes('StaleRefreshWarning'));
assert.ok(current.includes('isRefreshBlocked'));
assert.ok(current.includes('mobilePresentation={{'));
assert.ok(!current.includes("stress_level ?? 'Low'"));
assert.ok(!/data\?\.[a-z_]+ \?\? 0/.test(current), 'Missing metrics must not become zero');
const sourceLines = original.split('\n').length;
const closureLines = closure.split('\n').length;
assert.ok(closureLines >= sourceLines * 0.7, 'Production closure below 70%');
for (const file of [pagePath, ...production.map(file => path.relative(repo, path.join(newDir, file)))]) {
  const output = ts.transpileModule(read(path.join(repo, file)), {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
    reportDiagnostics: true,
    fileName: file,
  });
  assert.equal((output.diagnostics ?? []).filter(d => d.category === ts.DiagnosticCategory.Error).length, 0, file);
}
// Execute the real pure trust contract with no QueryClient or DOM mocks.
const trustJs = ts.transpileModule(read(path.join(repo, 'web/src/api/dataState.ts')), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const sandbox = { exports: {}, Error, Date };
vm.runInNewContext(trustJs, sandbox);
const { deriveDataState, knownNumber } = sandbox.exports;
const retained = { current_soh: 0, temp_exposure_score: null, history: [{ soh_pct: 0 }] };
const stale = deriveDataState({ data: retained, error: new Error('refresh failed') }, { provenance: 'inferred' });
assert.equal(stale.data, retained);
assert.equal(stale.status, 'stale');
assert.equal(stale.fatalError, null);
assert.equal(stale.refreshError.message, 'refresh failed');
const paused = deriveDataState({ data: retained, fetchStatus: 'paused' });
assert.equal(paused.data, retained);
assert.equal(paused.isRefreshBlocked, true);
assert.equal(deriveDataState({ error: new Error('initial failure') }).status, 'initialFailure');
assert.equal(knownNumber(0), 0);
assert.equal(knownNumber(null), null);
assert.equal(knownNumber(NaN), null);
const unitsJs = ts.transpileModule(read(path.join(repo, 'web/src/lib/unitConversion.ts')), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const unitsSandbox = { exports: {}, Intl };
vm.runInNewContext(unitsJs, unitsSandbox);
const units = unitsSandbox.exports;
const raw = Object.freeze({ capacity_wh: 72000, range_m: 450000 });
assert.equal(units.convertDistanceFromSI(raw.range_m, 'km'), 450);
assert.ok(Math.abs(units.convertDistanceFromSI(raw.range_m, 'mi') - 279.617036507) < 0.000001);
assert.equal(units.convertEnergyFromSI(raw.capacity_wh, 'kWh'), 72);
assert.equal(units.formatEnergy(null, { energy: 'kWh', locale: 'en-US' }), '—');
assert.equal(raw.capacity_wh, 72000);
assert.equal(raw.range_m, 450000);
const statsAst = parse('stats.tsx', read(path.join(newDir, 'BatteryDegradationStats.tsx')));
const ageFunction = collect(statsAst, node => ts.isFunctionDeclaration(node) && node.name?.text === 'ageLabel')[0];
const ageJs = ts.transpileModule(printed(ageFunction, statsAst), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const ageSandbox = { exports: {} };
vm.runInNewContext(ageJs, ageSandbox);
const translate = (_key, fallback, options = {}) => fallback.replace(/\{\{(\w+)\}\}/g, (_, key) => String(options[key]));
assert.equal(ageSandbox.exports.ageLabel(0, translate), '0 months');
assert.equal(ageSandbox.exports.ageLabel(13, translate), '1y 1m');
assert.equal(ageSandbox.exports.ageLabel(24, translate), '2 years');
assert.equal(ageSandbox.exports.ageLabel(NaN, translate), '—');
assert.equal(ageSandbox.exports.ageLabel(-1, translate), '—');
// Existing private specialist bytes are never leased by this modernization.
const manifest = JSON.parse(read(path.join(artifact, 'original-manifest.json')));
for (const entry of manifest.filter(entry => entry.path !== pagePath)) {
  const bytes = fs.readFileSync(path.join(repo, entry.path));
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex').toUpperCase(), entry.sha256, entry.path);
}
const hookText = read(path.join(repo, 'web/src/api/hooks/useEnergy.ts'));
const hookOriginal = read(path.join(artifact, 'original/web/src/api/hooks/useEnergy.ts'));
assert.equal(hookText, hookOriginal, 'Energy queries changed');
const router = read(path.join(repo, 'internal/api/router.go'));
assert.ok(router.includes('r.Get("/analytics/battery-health", batteryDegradationHandler.Health)'));
const annotations = router.match(/r\.Route\("\/annotations", func\(r chi\.Router\) \{([\s\S]*?)\n\s*\}\)/)?.[1];
assert.ok(annotations, 'Annotation route group missing');
for (const registration of [
  'r.Get("/", chartAnnotationHandler.List)',
  'r.Post("/", chartAnnotationHandler.Create)',
  'r.Patch("/{id}", chartAnnotationHandler.Update)',
  'r.Delete("/{id}", chartAnnotationHandler.Delete)',
]) assert.ok(annotations.includes(registration), `Annotation registration missing: ${registration}`);
console.log(`PASS: six section groups; series/axes/reference lines/brush/legends, projection math and hook operands match immutable dirty original.`);
console.log(`PASS: all five history fields/mobile roles and persistence IDs retained; private specialist hashes unchanged.`);
console.log(`PASS: pure real dataState retains exact payload on refresh error/paused; unknown != zero.`);
console.log(`PASS: pure real SI conversions preserve raw Wh/m; age formatting retains valid zero and rejects invalid ages.`);
console.log(`PASS: energy hook byte-identical; battery and annotation URLs match router routes.`);
console.log(`PASS: production closure ${closureLines}/${sourceLines} lines (${(100 * closureLines / sourceLines).toFixed(1)}%); owned syntax transpilation only.`);
console.log('NOTRUN: integrated TypeScript/build/runtime/browser/native acceptance. Source checks are not runtime coverage.');
