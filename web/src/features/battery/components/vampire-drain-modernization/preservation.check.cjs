/* Lightweight source/pure check only. No React mounting, catalogs, browser or project compilation.
 * Run from repo root: node web/src/features/battery/components/vampire-drain-modernization/preservation.check.cjs <artifact-directory>
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '../../../../../..');
const artifact = process.argv[2];
assert.ok(artifact, 'Immutable CURRENTDIRTY artifact directory is required');
const ts = createRequire(path.join(root, 'web/package.json'))('typescript');
const pagePath = 'web/src/features/battery/pages/VampireDrainPage.tsx';
const ownDir = 'web/src/features/battery/components/vampire-drain-modernization';
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8').replace(/\r\n/g, '\n');
const original = relative => fs.readFileSync(path.join(artifact, 'immutable-original', relative), 'utf8').replace(/\r\n/g, '\n');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const receipt = JSON.parse(fs.readFileSync(path.join(artifact, 'immutable-original-receipt.json'), 'utf8'));
for (const entry of receipt) {
  const frozen = fs.readFileSync(path.join(artifact, 'immutable-original', entry.path));
  assert.equal(sha(frozen), entry.sha256, `Immutable receipt: ${entry.path}`);
  assert.equal(frozen.length, entry.bytes);
  if (entry.path !== pagePath) {
    assert.equal(sha(fs.readFileSync(path.join(root, entry.path))), entry.sha256, `Read-only preservation: ${entry.path}`);
  }
}
console.log(`PASS immutable CURRENTDIRTY receipt and ${receipt.length - 1} relevant read-only sources`);

const oldPage = original(pagePath);
const page = read(pagePath);
const extract = (source, begin, end) => {
  const start = source.indexOf(begin);
  assert.ok(start >= 0, `Missing ${begin}`);
  const stop = source.indexOf(end, start);
  assert.ok(stop > start, `Missing end marker ${end}`);
  return source.slice(start, stop);
};
assert.equal(extract(page, 'export function buildDailyDrainRollup(', '/** Visual reference'),
  extract(oldPage, 'export function buildDailyDrainRollup(', '/** Visual reference'));
assert.equal(extract(page, '  const statsQuery = useQuery', '  const stats ='),
  extract(oldPage, '  const statsQuery = useQuery', '  const stats ='));
assert.equal(extract(page, '  const sortedEvents =', '  /** Drain-rate trend'),
  extract(oldPage, '  const sortedEvents =', '  /** Drain-rate trend'));
assert.equal(extract(page, '  const tips =', '  const noVehicleMsg'),
  extract(oldPage, '  const tips =', '  const noVehicleMsg'));
console.log('PASS exact query keys/operands/enabled/cancellation/default policies; rollup, sorting and four tips');

const ownTs = fs.readdirSync(path.join(root, ownDir)).filter(name =>
  /\.(ts|tsx)$/.test(name) && !name.endsWith('.test.tsx'));
const closure = [page, ...ownTs.map(name => read(`${ownDir}/${name}`))];
for (const relative of [pagePath, ...fs.readdirSync(path.join(root, ownDir))
  .filter(name => /\.(ts|tsx)$/.test(name)).map(name => `${ownDir}/${name}`)]) {
  const parsed = ts.createSourceFile(relative, read(relative), ts.ScriptTarget.Latest, true);
  assert.equal(parsed.parseDiagnostics.length, 0, `Owned TypeScript syntax: ${relative}`);
}
const oldPrivateLines = receipt.filter(entry => /components\/Vampire.*Panel\.tsx$/.test(entry.path))
  .reduce((sum, entry) => sum + original(entry.path).split('\n').length, 0);
const oldLines = oldPage.split('\n').length + oldPrivateLines;
const newLines = closure.reduce((sum, source) => sum + source.split('\n').length, 0);
assert.ok(page.split('\n').length >= oldPage.split('\n').length * 0.7);
assert.ok(newLines >= oldLines * 0.7);
console.log(`PASS closure lines original=${oldLines} current=${newLines} (${(100 * newLines / oldLines).toFixed(1)}%); page original=${oldPage.split('\n').length} current=${page.split('\n').length}`);
for (const source of closure) {
  assert.doesNotMatch(source, /style=\{\{|<(button|input|textarea|select|table)\b|from ['"](recharts|react-leaflet|framer-motion)['"]|[?&]vehicleId=/);
}
assert.equal((page.match(/<ChartContainer\b/g) || []).length, 2);
assert.equal((page.match(/<LayoutCard\b/g) || []).length, 6);
assert.equal((page.match(/<Section\b/g) || []).length, 3);
assert.ok(page.includes('chartKey="vampire-drain-rate-trend"'));
assert.ok(page.includes('chartKey="vampire-drain-daily"'));
assert.ok(page.includes('tableId="battery:vampire-drain-sessions"'));
for (const key of ['rate', 'drain_pct', 'hours']) assert.ok(page.includes(`isHidden('${key}')`));
for (const id of ['left', 'right']) assert.ok(page.includes(`yAxisId="${id}"`));
for (const key of ['started_at', 'duration_hours', 'start_battery_pct', 'end_battery_pct', 'drain_pct', 'drain_pct_per_day', 'ambient_temp_c_avg']) {
  assert.ok(page.includes(`key: '${key}'`));
}
console.log('PASS shells, all seven columns, stable table/chart IDs, all three chart series, dual axes and zero prohibited source patterns');
assert.ok(page.includes('query={[statsQuery, eventsQuery]}'), 'Preserve real header freshness inputs');
assert.equal((page.match(/\n\s+fullscreen\n/g) || []).length, 2);
assert.equal((page.match(/exportData=\{/g) || []).length, 2);
const oldCulprit = original('web/src/features/battery/components/VampireCulpritPanel.tsx');
const newCulprit = read(`${ownDir}/VampireCulpritPanel.tsx`);
assert.equal(extract(oldCulprit, 'const ACTION:', '\n\nexport function'),
  extract(newCulprit, 'const ACTION:', '\n\n/** Derivation'));
console.log('PASS owned TypeScript syntax, exact six culprit actions, original header freshness and real chart export/fullscreen wiring');

function pureModule(source, imports = {}) {
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  vm.runInNewContext(compiled, {
    exports, require: name => {
      assert.ok(name in imports, `Unexpected pure-check dependency ${name}`);
      return imports[name];
    }, Map, Date, Intl, console,
  });
  return exports;
}
for (const [id, size] of [
  ['drain-trend', 'half'], ['drain-gauge', 'quarter'],
  ['daily-drain', 'half'], ['drain-tips', 'quarter'],
]) {
  assert.ok(page.includes(`{ id: '${id}', size: '${size}', content: (`), `Unsupported size for ${id}`);
}
const { packCardRows } = pureModule(read('web/src/components/layout/layout-reference/layoutPolicy.ts'));
for (const width of [320, 375, 430]) {
  assert.deepEqual(Array.from(packCardRows(['half', 'quarter'], width)), [1, 1]);
}
for (const width of [768, 1023]) {
  assert.deepEqual(Array.from(packCardRows(['half', 'quarter'], width)), [6, 6]);
}
for (const width of [1024, 1280, 1920]) {
  assert.deepEqual(Array.from(packCardRows(['half', 'quarter'], width)), [8, 4]);
}
console.log('PASS supported card sizes: stacked phone/tablet, 8:4 desktop spans at exact breakpoints');
const rollupSource = extract(page, 'export function buildDailyDrainRollup(', '/** Visual reference');
const dayKey = (value, timeZone) => {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timeZone || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date);
};
const rollup = pureModule(`import { localDayKey } from 'day';\n${rollupSource}`, { day: { localDayKey: dayKey } }).buildDailyDrainRollup;
const inputs = [
  { started_at: '2025-06-04T01:00:00Z', drain_pct: 1.5, duration_hours: 2 },
  { started_at: '2025-06-04T02:00:00Z', drain_pct: 0.5, duration_hours: 3 },
  { started_at: 'invalid', drain_pct: 9, duration_hours: 9 },
  { started_at: '2025-06-05T02:00:00Z', drain_pct: 0, duration_hours: 1 },
];
const copy = JSON.stringify(inputs);
assert.deepEqual(JSON.parse(JSON.stringify(rollup(inputs, 'America/Los_Angeles'))), [
  { date: '2025-06-03', drain_pct: 2, hours: 5 },
  { date: '2025-06-04', drain_pct: 0, hours: 1 },
]);
assert.equal(JSON.stringify(inputs), copy);
assert.equal(rollup([], 'UTC').length, 0);
console.log('PASS pure unchanged rollup: vehicle midnight, aggregation, invalid start, real zero, empty input and immutability');

const derive = pureModule(read('web/src/features/battery/lib/vampireCulprits.ts')).deriveVampireCulprits;
const unknown = derive(undefined, undefined);
assert.equal(unknown.tonight, 'unknown');
assert.ok(unknown.culprits.every(row => row.evidence === 'missing' && row.drainPct === null));
const partial = derive(undefined, { unplugged_drain_pct: 6, complete_plugged_drain_pct: null });
assert.equal(partial.tonight, 'unplugged_leak');
assert.equal(partial.culprits.find(row => row.id === 'sentry').evidence, 'missing');
console.log('PASS pure byte-preserved culprit derivation: missing is unknown; independent split evidence remains');

const mobile = pureModule(read(`${ownDir}/sessionPresentation.ts`), {
  '@/lib/dateFormat': { formatDateTime: value => `DATE:${value}` },
}).sessionPresentation(value => value == null ? '—' : value.toFixed(2),
  value => value == null ? '—' : `TEMP:${value}`, (_key, fallback) => fallback);
const event = {
  started_at: 'start', ended_at: 'end', duration_hours: 6, start_battery_pct: 90,
  end_battery_pct: 84, drain_pct: 6, drain_pct_per_day: 8, ambient_temp_c_avg: 25,
};
const eventCopy = JSON.stringify(event);
assert.equal(mobile.displayValue(event, 'ambient_temp_c_avg'), 'TEMP:25');
assert.equal(mobile.displayValue({ ...event, ambient_temp_c_avg: null }, 'ambient_temp_c_avg'), '—');
assert.equal(mobile.displayValue(event, 'start_battery_pct'), '90.00%');
assert.equal(mobile.allDetails(event)[0].key, 'ended_at');
assert.equal(mobile.allDetails(event).length, 1, 'Do not duplicate DataTable-owned column details');
assert.equal(JSON.stringify(event), eventCopy);
console.log('PASS pure mobile display adapter: raw Celsius boundary, null, hidden-field access, end timestamp and no mutation/duplicate column details');

const routes = read('internal/api/router.go');
assert.ok(routes.includes('r.Route("/vampire-drain"'));
assert.ok(routes.includes('r.Get("/", vampireDrainHandler.Events)'));
assert.ok(routes.includes('r.Get("/stats", vampireDrainHandler.Stats)'));
assert.ok(routes.includes('r.Get("/vampire", physicsHandler.Vampire)'));
assert.ok(routes.includes('r.Get("/park-truth", physicsHandler.ParkTruth)'));
console.log('PASS backend matches: /vampire-drain, /vampire-drain/stats, /physics/vampire, /physics/park-truth');
const english = {};
for (const source of closure) {
  const parsed = ts.createSourceFile('owned.tsx', source, ts.ScriptTarget.Latest, true);
  function visit(node) {
    if (ts.isCallExpression(node) && node.expression.getText(parsed) === 't'
      && node.arguments.length >= 2 && ts.isStringLiteral(node.arguments[0])
      && ts.isStringLiteral(node.arguments[1])
      && node.arguments[0].text.startsWith('vampireDrain.modernization.')) {
      english[node.arguments[0].text] = node.arguments[1].text;
    }
    ts.forEachChild(node, visit);
  }
  visit(parsed);
}
assert.deepEqual(english, JSON.parse(fs.readFileSync(path.join(artifact, 'english-request.json'), 'utf8')));
console.log(`PASS exact additive English artifact: ${Object.keys(english).length} keys; catalogs not read or written`);
console.log('RUNTIME=NOTRUN; TYPESCRIPT_PROJECT=NOTRUN; BUILD=NOTRUN; BROWSER=NOTRUN; CATALOG=NOTRUN');
