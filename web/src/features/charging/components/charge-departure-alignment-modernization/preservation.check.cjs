/* Source + pure checks only; deliberately does not run a TS program, app or runtime suite.
 * Usage: node preservation.check.cjs <owned artifact root with CURRENTDIRTY receipt>
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createRequire } = require('node:module');

const root = path.resolve(__dirname, '../../../../../..');
const artifact = process.argv[2];
assert(artifact, 'Pass the immutable CURRENTDIRTY artifact root');
const pagePath = 'web/src/features/charging/pages/ChargeDepartureAlignmentPage.tsx';
const privatePath = 'web/src/features/charging/components/charge-departure-alignment-modernization';
const modelPath = 'web/src/features/charging/lib/chargeDepartureAlignment.ts';
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const ts = createRequire(path.join(root, 'web/package.json'))('typescript');
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').toUpperCase();
const receipt = JSON.parse(fs.readFileSync(path.join(artifact, 'original-receipt.json'), 'utf8'));
assert.equal(receipt.branch, 'fix/dashboard-followups');
assert.equal(receipt.newDirectoryAbsent, true);
for (const file of receipt.files) {
  assert.equal(file.acquisition, 'CURRENTDIRTY');
  assert.equal(sha(path.join(artifact, 'CURRENTDIRTY', file.path)), file.sha256);
  if (file.path !== pagePath) assert.equal(sha(path.join(root, file.path)), file.sha256, `Read-only original changed: ${file.path}`);
}
console.log('CURRENTDIRTY immutable originals + unchanged direct model/tests: PASS');

const original = fs.readFileSync(path.join(artifact, 'CURRENTDIRTY', pagePath), 'utf8');
const productionPaths = [pagePath, ...['index.ts', 'presentation.ts', 'AlignmentStats.tsx', 'AlignmentPairs.tsx']
  .map(file => `${privatePath}/${file}`)];
const page = read(pagePath);
const stats = read(`${privatePath}/AlignmentStats.tsx`);
const pairs = read(`${privatePath}/AlignmentPairs.tsx`);
const production = productionPaths.map(read).join('\n');
const parse = (source, name = 'source.tsx') => ts.createSourceFile(name, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const printer = ts.createPrinter({ removeComments: true });
const print = (node, source) => printer.printNode(ts.EmitHint.Unspecified, node, source);
const walk = (node, visit) => { visit(node); ts.forEachChild(node, child => walk(child, visit)); };
const sourceFiles = productionPaths.map(file => parse(read(file), file));
for (const file of sourceFiles) assert.equal(file.parseDiagnostics.length, 0, `Syntax failure: ${file.fileName}`);

function variable(source, name) {
  const file = parse(source);
  let result;
  walk(file, node => {
    if (ts.isVariableDeclaration(node) && node.name.getText(file) === name)
      result = print(node.initializer, file);
  });
  assert(result, `Variable missing: ${name}`);
  return result;
}
for (const name of ['summary', 'chartData', 'exportData', 'hiddenSeries', 'vehicleIdStr'])
  assert.equal(variable(page, name), variable(original, name), `Calculation/persistence changed: ${name}`);
assert.match(page, /useChargingHistory\(vehicleIdStr\)/);
assert.match(page, /useDriveHistory\(vehicleIdStr\)/);
assert.match(page, /const CHART_KEY = 'charge-departure-alignment'/);
function chartNodes(source) {
  const file = parse(source);
  const nodes = [];
  walk(file, node => {
    if ((ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node))
      && ['ResponsiveContainer', 'ComposedChart', 'CartesianGrid', 'XAxis', 'YAxis',
        'Tooltip', 'ChartLegend', 'Bar', 'Line', 'Cell'].includes(node.tagName.getText(file)))
      nodes.push(print(node, file));
  });
  return nodes;
}
assert.deepEqual(chartNodes(page), chartNodes(original), 'Original chart capabilities/axes/series must remain');
for (const attribute of ['chartKey={CHART_KEY}', 'height={340}', 'data={exportData}', 'dataColumns={['])
  assert(page.includes(attribute), `Missing chart export/table identity: ${attribute}`);
assert.match(page, /<ChartContainer/);
assert(!page.includes('chartData.length === 0 ?'), 'Chart shell must be persistent');
assert.match(page, /<PageLayout/);
assert.match(stats, /<StatStrip/);
assert.match(pairs, /<DataTable/);
assert.match(pairs, /mobilePresentation=/);
assert.match(pairs, /tableId="charge-departure-alignment-pairs"/);
assert.match(pairs, /const rows = \[\.\.\.pairs\]\.reverse\(\)/);
assert(!pairs.includes('.slice(0, 12)'), 'All loaded pairs must stay reachable');
const fields = [
  'chargeEndedMs', 'driveStartMs', 'dwellS', 'readinessMarginPct', 'socUsedPct',
  'endSocPct', 'driveStartSocPct', 'driveEndSocPct', 'socDriftPct', 'earlyFullDwellS',
  'flags', 'chargeId', 'driveId',
];
for (const field of fields) assert.match(pairs, new RegExp(`(?:column\\('${field}'|key: '${field}')`));
for (const flag of ['tight_margin', 'excess_buffer', 'early_full_dwell', 'long_dwell', 'soc_mismatch'])
  assert(pairs.includes(`${flag}:`), `Flag translation lost: ${flag}`);
for (const key of ['avgDwell', 'avgMargin', 'misaligned', 'paired', 'avgDwellHint', 'avgMarginHint', 'misalignedHint', 'pairedHint'])
  assert(stats.includes(`'chargeDepartureAlignment.${key}'`), `Original metric/context lost: ${key}`);
for (const help of ['avgMargin', 'misaligned'])
  assert(stats.includes(`'help.chargeDepartureAlignment.${help}'`));
assert(pairs.includes('"help.chargeDepartureAlignment.detail"'));
assert.match(stats, /rawValue: hasPairs \? summary.avgDwellS : undefined/);
assert.match(stats, /rawValue: hasPairs \? summary.misalignedRatePct : undefined/);
assert.match(stats, /durationStyle: 'roundedMinutes'/);
assert.match(stats, /const percentDisplay = \{ precision, units: \{ locale \} \}/);
assert.match(page, /deriveDataState\(sessionsQuery, \{ provenance: 'historical' \}\)/);
assert.match(page, /deriveDataState\(drivesQuery, \{ provenance: 'historical' \}\)/);
assert.match(page, /const fatalError = sessionsState.fatalError \?\? drivesState.fatalError/);
assert.match(page, /<StaleRefreshWarning state=\{state\} label=\{label\}/);
assert(!/error=\{(?:sessionsQuery|drivesQuery)\.error\}/.test(page));
assert(!/\b(?:RangePicker|VehicleSelect|DateRangeFilter|useRangeState)\b/.test(production));
console.log('Source preservation: 4 metrics, 3 section shells, 13 pair fields, 5 flags, original chart nodes/query calls: PASS');

for (const [name, pattern] of [
  ['inline styles', /style=\{\{/g],
  ['raw interactive/table HTML', /<(?:button|input|textarea|select|table)\b/g],
  ['direct chart/map/motion imports', /from\s+['"](?:recharts|react-leaflet|framer-motion)['"]/g],
  ['camel vehicle URL', /vehicleId=/g],
]) {
  const count = (production.match(pattern) ?? []).length;
  console.log(`${name}: ${count}`);
  assert.equal(count, 0);
}
const originalLines = original.trimEnd().split(/\r?\n/).length;
const closureLines = productionPaths.reduce((sum, file) => sum + read(file).trimEnd().split(/\r?\n/).length, 0);
console.log(`Production closure: ${closureLines}/${originalLines} lines (${(closureLines / originalLines * 100).toFixed(1)}%); tests/guard excluded`);
assert(closureLines >= originalLines * 0.7);
console.log(`Panel/ChartContainer source references: original=${(original.match(/GlassPanel|ChartContainer/g) ?? []).length}, page=${(page.match(/GlassPanel|ChartContainer/g) ?? []).length}, closure=${(production.match(/GlassPanel|ChartContainer/g) ?? []).length}; three semantic sections preserved (stats/chart/details)`);

const router = read('internal/api/router.go');
for (const [hook, endpoint, hookFile] of [
  ['useChargingHistory', '/charging', 'web/src/api/hooks/useCharging.ts'],
  ['useDriveHistory', '/drives', 'web/src/api/hooks/useDriving.ts'],
]) {
  const file = parse(read(hookFile), hookFile);
  let declaration;
  walk(file, node => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === hook) declaration = node.getText(file);
  });
  assert(declaration?.includes(`${endpoint}?vehicle_id=`));
  assert(declaration.includes('limit = 1000'));
  assert(declaration.includes('{ signal }'));
  assert(!declaration.includes('/api/v1'));
  const routeStart = router.indexOf(`r.Route("${endpoint}"`);
  assert(routeStart >= 0);
  assert.match(router.slice(routeStart, routeStart + 420), /r.Get\("\/"/);
  console.log(`${hook} → ${endpoint}?vehicle_id=…&limit=1000 → router.go GET ${endpoint}/: MATCH`);
}

// Pure execution via single-file transpilation, never a TypeScript program/typecheck.
function loadPure(source, name) {
  const result = ts.transpileModule(source, { fileName: name, compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
  } });
  const exports = {};
  const module = { exports };
  new Function('exports', 'module', 'require', result.outputText)(
    exports, module, specifier => { throw new Error(`Unexpected pure dependency: ${specifier}`); },
  );
  return module.exports;
}
const presentation = loadPure(read(`${privatePath}/presentation.ts`), 'presentation.ts');
assert.equal(presentation.observedBounds([null, undefined, 'invalid']), null);
const early = '2026-10-04T01:30:00-07:00';
const late = '2026-10-04T01:30:00-06:00';
assert.deepEqual(presentation.observedBounds([early, null, 'invalid', late]), {
  first: Date.parse(late), last: Date.parse(early), count: 2,
});
const model = loadPure(read(modelPath), 'chargeDepartureAlignment.ts');
const anchor = Date.parse('2026-10-04T08:00:00Z');
const charge = (id, end = anchor, endSoc = 95) => ({
  id, ended_at: new Date(end).toISOString(), end_soc_pct: endSoc, start_soc_pct: 10,
});
const drive = (id, start, startSoc = 94, endSoc = 15) => ({
  id, startTs: new Date(start).toISOString(), startBatteryPct: startSoc, endBatteryPct: endSoc,
});
let summary = model.analyzeChargeDepartureAlignment([charge('c')], [drive(1, anchor + 3_600_000)]);
assert.deepEqual(summary.pairs[0].flags, ['tight_margin', 'early_full_dwell']);
assert.equal(summary.pairs[0].socDriftPct, -1, 'Ordinary vampire drain remains unflagged');
summary = model.analyzeChargeDepartureAlignment([charge('a'), charge('b', anchor + 1)], [drive(2, anchor + 4 * 3_600_000, 99, 90)]);
assert.equal(summary.pairedCount, 1);
assert.equal(summary.unpairedCount, 1);
assert.equal(summary.pairs[0].chargeId, 'b');
assert(summary.pairs[0].flags.includes('soc_mismatch'));
assert(summary.pairs[0].flags.includes('excess_buffer'));
assert.equal(model.analyzeChargeDepartureAlignment([charge('c')], [drive(1, anchor + 24 * 3_600_000)]).pairedCount, 1);
assert.equal(model.analyzeChargeDepartureAlignment([charge('c')], [drive(1, anchor + 24 * 3_600_000 + 1)]).pairedCount, 0);
assert.equal(model.analyzeChargeDepartureAlignment([charge('c')], [drive(1, anchor)]).pairedCount, 0);
summary = model.analyzeChargeDepartureAlignment([charge('c', anchor, 80)], [drive(1, anchor + 4 * 3_600_000, 79, 50)]);
assert.deepEqual(summary.pairs[0].flags, ['excess_buffer', 'long_dwell']);
summary = model.analyzeChargeDepartureAlignment([charge('c', anchor, 95)], [drive(1, anchor + 4 * 3_600_000, 94, 50)]);
assert(summary.pairs[0].flags.includes('early_full_dwell'));
assert(!summary.pairs[0].flags.includes('long_dwell'), 'Already-full dwell takes precedence over generic long dwell');
const unknown = model.analyzeChargeDepartureAlignment([charge('c', anchor, null)], [drive(1, anchor + 1000, null, null)]).pairs[0];
const display = presentation.pairDisplayValues(unknown, value => String(value),
  value => new Intl.NumberFormat('de-DE', { minimumFractionDigits: 3, maximumFractionDigits: 3 }).format(value) + '%',
  value => `${value}s`, () => 'flags');
assert.equal(display.readinessMarginPct, '—');
assert.equal(display.socUsedPct, '—');
assert.equal(display.socDriftPct, '—');
assert.equal(display.dwellS, '1s');
assert.equal(display.driveId, 1);
assert.deepEqual(Object.keys(display).sort(), fields.slice().sort());
assert.equal(presentation.pairDisplayValues({ ...unknown, readinessMarginPct: 0 }, String, String, String, () => '').readinessMarginPct, '0');
console.log('Pure checks: observed bounds, invalid timestamps, SI display, unknown vs measured zero, temporal limits, deduplication and heuristic boundaries: PASS');

// Exact additive request; reject scalar-parent/child collisions in both request and canonical English.
const request = JSON.parse(fs.readFileSync(path.join(artifact, 'english-additive-request.json'), 'utf8'));
const canonical = JSON.parse(read('web/src/i18n/en.json'));
const newStrings = new Map();
for (const file of sourceFiles) {
  walk(file, node => {
    if (ts.isCallExpression(node) && node.expression.getText(file) === 't'
      && ts.isStringLiteral(node.arguments[0]) && ts.isStringLiteral(node.arguments[1])
      && node.arguments[0].text.startsWith('chargeDepartureAlignment.modernization.')) {
      newStrings.set(node.arguments[0].text, node.arguments[1].text);
    }
  });
}
function leaves(value, prefix = '') {
  return Object.entries(value).flatMap(([key, child]) => typeof child === 'string'
    ? [[prefix + key, child]] : leaves(child, prefix + key + '.'));
}
const requested = new Map(leaves(request));
assert.deepEqual([...requested].sort(), [...newStrings].sort(), 'English request must exactly match production fallbacks');
for (const [key, value] of requested) {
  let current = canonical;
  const segments = key.split('.');
  for (let index = 0; index < segments.length; index++) {
    if (current == null) break;
    assert.equal(typeof current, 'object', `Scalar parent collision: ${key}`);
    current = current[segments[index]];
    if (index === segments.length - 1 && current !== undefined) assert.equal(current, value);
  }
}
console.log(`English additive request: ${requested.size} exact fallbacks; scalar-parent/child collision check: PASS (canonical remains READONLY)`);
console.log('Runtime suite: AUTHORED_NOTRUN. No app, browser, catalog, build or full TypeScript validation performed.');
