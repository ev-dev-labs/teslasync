/* Own lightweight source/pure guard. NOT a Vitest test, project build or typecheck.
 * Usage: node <this-file> <absolute artifact directory>
 */
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const ts = require(path.resolve('web/node_modules/typescript'));
const artifact = process.argv[2];
assert.ok(artifact, 'An immutable acquisition artifact directory is required');
const root = process.cwd();
const ownedDir = 'web/src/features/battery/components/cycle-stress-modernization';
const pagePath = 'web/src/features/battery/pages/CycleStressPage.tsx';
const privateDir = 'web/src/features/battery/components/cycle-stress';
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const baseline = relative => fs.readFileSync(path.join(artifact, 'original', relative), 'utf8');
const receipt = JSON.parse(fs.readFileSync(path.join(artifact, 'original-acquisition.json'), 'utf8'));
const hash = value => crypto.createHash('sha256').update(value).digest('hex').toUpperCase();
let unchanged = 0;
for (const file of receipt.files) {
  assert.equal(hash(fs.readFileSync(path.join(artifact, 'original', file.path))), file.sha256,
    `immutable acquisition: ${file.path}`);
  if (file.path !== pagePath) {
    assert.equal(hash(fs.readFileSync(path.join(root, file.path))), file.sha256,
      `read-only private source changed: ${file.path}`);
    unchanged++;
  }
}
console.log(`PASS immutable acquisition and ${unchanged} unchanged private source hashes`);

const oldPage = baseline(pagePath);
const page = read(pagePath);
const sectionNames = [...oldPage.matchAll(/<(CycleStress\w+)\b/g)].map(match => match[1]);
assert.equal(sectionNames.length, 15);
for (const section of sectionNames) {
  assert.ok(page.includes(`<${section === 'CycleStressKpiBand' ? 'CycleStressSummary' : section}`),
    `missing section ${section}`);
}
const derivation = text => text.slice(text.indexOf('  const vehicleIdStr ='), text.indexOf('  const vehicleSelected =') === -1
  ? text.indexOf('  const trust =') : text.indexOf('  const vehicleSelected ='));
assert.equal(derivation(page), derivation(oldPage), 'hooks, memoized rows, options, frozen clock and analysis must be byte-identical');
assert.deepEqual([...page.matchAll(/<FadeIn(?: delay=\{([^}]+)\})?>/g)].map(match => match[1]),
  [...oldPage.matchAll(/<FadeIn(?: delay=\{([^}]+)\})?>/g)].map(match => match[1]));
assert.ok(page.includes('<PageLayout'));
assert.ok(page.includes('@[1024px]:grid-cols-2'));
assert.ok(!/max-w-|<ChartContainer/.test(page), 'no page width clamp or substituted chart containers');
console.log('PASS all 15 section invocations, byte-identical query/analysis block and all 12 motion delays');

// Windows-owned files use CRLF; acquisition preserves the original LF bytes.
// Normalize ONLY line endings for AST comparison, never receipt/hash evidence.
const parse = (text, filename = 'source.tsx') => ts.createSourceFile(filename, text.replace(/\r\n/g, '\n'), ts.ScriptTarget.Latest, true);
// Structural syntax fingerprint: retain every node kind/token/literal, ignoring
// source offsets/comments and JSX indentation-only text. Unlike stripping all
// whitespace, this keeps spaces inside translated strings and meaningful text.
function fingerprint(node) {
  if (ts.isJsxText(node) && node.text.trim() === '') return null;
  const text = ts.isIdentifier(node) || ts.isPrivateIdentifier(node)
    || ts.isStringLiteralLike(node) || ts.isNumericLiteral(node) || ts.isJsxText(node)
    ? node.text : null;
  const children = [];
  ts.forEachChild(node, child => {
    const value = fingerprint(child);
    if (value !== null) children.push(value);
  });
  return [node.kind, text, children];
}
function variable(source, name) {
  let found;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === name) found = node.initializer;
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(found, `missing ${name}`);
  return JSON.stringify(fingerprint(found));
}
function cards(source) {
  const found = [];
  function visit(node) {
    if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(source) === 'MetricCard') {
      found.push(fingerprint(node));
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return found;
}
for (const name of ['CycleStressDirectory', 'CycleStressAccounting']) {
  const old = parse(baseline(`${privateDir}/${name}.tsx`));
  const current = parse(read(`${ownedDir}/${name}.tsx`));
  assert.equal(variable(current, 'rows'), variable(old, 'rows'), `${name} row derivation`);
  assert.equal(variable(current, 'columns'), variable(old, 'columns'), `${name} all columns and formatters`);
  assert.deepEqual(cards(current), cards(old), `${name} all original metric cards`);
  assert.ok(read(`${ownedDir}/${name}.tsx`).includes('mobilePresentation={mobilePresentation}'));
  const oldId = baseline(`${privateDir}/${name}.tsx`).match(/tableId="([^"]+)"/)[1];
  assert.ok(read(`${ownedDir}/${name}.tsx`).includes(`tableId="${oldId}"`));
}
console.log('PASS both table row/column ASTs, all four accounting metric cards and persistence IDs');
const kpiKeys = [...baseline(`${privateDir}/CycleStressKpiBand.tsx`).matchAll(/['"](cycleStress\.[^'"]+)['"]/g)]
  .map(match => match[1]);
const summary = read(`${ownedDir}/CycleStressSummary.tsx`);
for (const key of kpiKeys) assert.ok(summary.includes(`'${key}'`), `lost KPI translation/meaning ${key}`);
assert.equal((summary.match(/metric\('cycle-stress:/g) ?? []).length, 6);
assert.ok(summary.includes("kind: 'unknown'"));
assert.ok(summary.includes("rawValue: resolved && value !== '—' ? value : null"));
const oldKpi = parse(baseline(`${privateDir}/CycleStressKpiBand.tsx`));
const newKpi = parse(summary);
const oldValues = [];
const newValues = [];
function collectOldValues(node) {
  if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(oldKpi) === 'MetricCard') {
    const value = node.attributes.properties.find(prop => ts.isJsxAttribute(prop) && prop.name.getText(oldKpi) === 'value');
    assert.ok(value && ts.isJsxExpression(value.initializer)
      && ts.isConditionalExpression(value.initializer.expression));
    oldValues.push(fingerprint(value.initializer.expression.whenTrue));
  }
  ts.forEachChild(node, collectOldValues);
}
function collectNewValues(node) {
  if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'metric') {
    newValues.push(fingerprint(node.arguments[2]));
  }
  ts.forEachChild(node, collectNewValues);
}
collectOldValues(oldKpi);
collectNewValues(newKpi);
assert.deepEqual(newValues, oldValues, 'all six specialist KPI value/formatter expressions must remain identical');
console.log('PASS all original KPI labels/descriptions/selectors, six specialist values and bounded unknown period');

const router = read('internal/api/router.go');
for (const [hook, route, fn] of [
  ['web/src/api/hooks/useCharging.ts', '/charging', 'useChargingHistory'],
  ['web/src/api/hooks/useDriving.ts', '/drives', 'useDriveHistory'],
]) {
  const hookSource = read(hook).split(`export function ${fn}`)[1].split('\n}')[0];
  assert.ok(hookSource.includes(`${route}?vehicle_id=`));
  assert.ok(hookSource.includes('{ signal }'));
  assert.ok(hookSource.includes('limit=${boundedLimit}'));
  assert.ok(!hookSource.includes('/api/v1/'));
  assert.ok(router.includes(`r.Route("${route}"`));
  const routeBlock = router.split(`r.Route("${route}"`)[1].slice(0, 200);
  assert.ok(routeBlock.includes('r.Get("/",'));
}
console.log('PASS /charging and /drives history hook URLs match router.go; cap, snake_case and cancellation retained');

// Pure execution of OWN trust adapter against the real shared deriveDataState.
// Transpilation is syntax-only, not typechecking. Nothing is written to disk.
function loadTs(relative, dependencies = {}) {
  const output = ts.transpileModule(read(relative), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', output)(id => {
    assert.ok(Object.hasOwn(dependencies, id), `unexpected runtime dependency ${id}`);
    return dependencies[id];
  }, module, module.exports);
  return module.exports;
}
const dataState = loadTs('web/src/api/dataState.ts');
const { cycleStressQueryState } = loadTs(`${ownedDir}/queryState.ts`, { '@/api/dataState': dataState });
const failure = new Error('failure');
const initial = cycleStressQueryState(true, {}, {});
assert.equal(initial.state.isResolved, false);
const empty = cycleStressQueryState(true, { data: [] }, { data: [] });
assert.equal(empty.state.isResolved, true);
const rows = [];
const retained = cycleStressQueryState(true, { data: rows, isError: true, error: failure }, { data: [] });
assert.equal(retained.state.error, null);
assert.equal(retained.state.refreshError, failure);
assert.equal(retained.sources[0].trust.data, rows);
let chargingRetries = 0;
let driveRetries = 0;
const partial = cycleStressQueryState(true, { isError: true, error: failure,
  refetch: () => { chargingRetries++; } }, { data: [], refetch: () => { driveRetries++; } });
assert.deepEqual(partial.state.failedSources, ['charging']);
assert.equal(partial.fatalError, null);
partial.state.onRetry();
assert.equal(chargingRetries, 1);
assert.equal(driveRetries, 0);
const pending = cycleStressQueryState(true, { isError: true, error: failure }, { isLoading: true });
assert.equal(pending.fatalError, null);
assert.equal(pending.state.isResolved, false);
const fatal = cycleStressQueryState(true, { isError: true, error: failure }, { isError: true });
assert.equal(fatal.fatalError, failure);
const paused = cycleStressQueryState(true, { fetchStatus: 'paused' }, { fetchStatus: 'paused' });
assert.equal(paused.state.isResolved, false);
assert.ok(paused.sources.every(source => source.trust.isRefreshBlocked));
const disabled = cycleStressQueryState(false, { isError: true }, { isError: true });
assert.equal(disabled.state.isResolved, false);
assert.equal(disabled.fatalError, null);
console.log('PASS 8 own pure trust scenarios: initial/empty/retained/partial/pending/fatal/paused/disabled');

const ownedFiles = [pagePath, ...fs.readdirSync(path.join(root, ownedDir))
  .filter(file => /\.(tsx?|cjs)$/.test(file)).map(file => `${ownedDir}/${file}`)];
const productionFiles = ownedFiles.filter(file => !/\.test\.|\.check\./.test(file));
const patterns = {
  inlineStyles: /style=\{\{/g,
  rawControlsOrTables: /<(?:button|input|textarea|select|table)\b/g,
  directLibraries: /from ['"](?:recharts|react-leaflet|framer-motion)['"]/g,
  vehicleIdUrl: /vehicleId=/g,
};
for (const [name, pattern] of Object.entries(patterns)) {
  const count = productionFiles.reduce((sum, file) => sum + [...read(file).matchAll(pattern)].length, 0);
  console.log(`AUDIT ${name}=${count}`);
  assert.equal(count, 0, name);
}
let syntaxErrors = 0;
for (const file of ownedFiles.filter(file => /\.tsx?$/.test(file))) {
  const diagnostics = ts.transpileModule(read(file), {
    fileName: file, reportDiagnostics: true,
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).diagnostics ?? [];
  for (const diagnostic of diagnostics.filter(item => item.category === ts.DiagnosticCategory.Error)) {
    syntaxErrors++;
    console.log(ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));
  }
}
assert.equal(syntaxErrors, 0);
console.log(`PASS own ${ownedFiles.filter(file => /\.tsx?$/.test(file)).length} TypeScript files syntax-only transpilation (NOT tsc)`);

const lines = text => text.split(/\r?\n/).length - (text.endsWith('\n') ? 1 : 0);
const originalLines = receipt.files.reduce((sum, file) => sum + file.lines, 0);
const replaced = ['CycleStressKpiBand.tsx', 'CycleStressDirectory.tsx', 'CycleStressAccounting.tsx'];
const reused = receipt.files.filter(file => file.path !== pagePath && !replaced.some(name => file.path.endsWith(`/${name}`)));
const closureLines = reused.reduce((sum, file) => sum + lines(read(file.path)), 0)
  + productionFiles.reduce((sum, file) => sum + lines(read(file)), 0);
const ratio = closureLines / originalLines;
const panelCount = files => files.reduce((sum, file) => sum + (read(file).match(/<(?:GlassPanel|ChartContainer)\b/g) ?? []).length, 0);
const originalPanelCount = receipt.files.reduce((sum, file) =>
  sum + (baseline(file.path).match(/<(?:GlassPanel|ChartContainer)\b/g) ?? []).length, 0);
console.log(`PRESERVATION original page=${receipt.files.find(file => file.path === pagePath).lines}; current page=${lines(page)}`);
console.log(`PRESERVATION original direct closure=${originalLines}; current active production closure=${closureLines}; ratio=${(ratio * 100).toFixed(2)}%`);
console.log(`SECTIONS original GlassPanel/ChartContainer=${originalPanelCount}; current active=${panelCount([...reused.map(file => file.path), ...productionFiles])}`);
assert.ok(ratio >= 0.7);
console.log('LIMITATION runtime tests, full TypeScript, project-wide lint/build/browser/catalog verification NOT RUN; parent serialized validation required');
