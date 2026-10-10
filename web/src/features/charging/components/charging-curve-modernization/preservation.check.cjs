/* Node-only source/pure guard, not a Vitest test or runtime acceptance claim. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');
const ts = require('typescript');

const root = path.resolve(__dirname, '../../../../../..');
const artifact = 'C:/Users/AtulM/.copilot/session-state/bba4960d-f516-4831-bda3-877640f907ce/files/parallel-charging-curve-page-live';
const baseline = path.join(artifact, 'acquisition');
const pagePath = 'web/src/features/charging/pages/ChargingCurvePage.tsx';
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const original = fs.readFileSync(path.join(baseline, pagePath), 'utf8');
const current = read(pagePath);
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex').toUpperCase();
assert.equal(hash(fs.readFileSync(path.join(baseline, pagePath))),
  'C9285742F30E94BCC4B8BC739186F22D83B1AC233FF494AECAA70A76A041BDF0',
  'The immutable CURRENT dirty acquisition must not be replaced');

const receipts = [];
function check(name, callback) {
  callback();
  receipts.push({ name, result: 'PASS' });
  console.log(`PASS ${name}`);
}
function slice(source, start, end) {
  const from = source.indexOf(start);
  assert.notEqual(from, -1, `Missing ${start}`);
  const to = source.indexOf(end, from);
  assert.notEqual(to, -1, `Missing ${end}`);
  return source.slice(from, to + end.length);
}
check('Exact original aggregate operands, denominator, extrema and dependencies', () => {
  assert.equal(slice(current, 'const stats =', '}, [sessions, hasSessions]);'),
    slice(original, 'const stats =', '}, [sessions, hasSessions]);'));
});
check('Range identity/defaults, source query limit/bounds, selector and generated-curve inputs', () => {
  for (const [start, end] of [
    ['const { start, end, reset }', '});'],
    ['const sessionsQuery =', ';'],
    ['const sessionOptions =', ');'],
    ['const handleSessionChange =', '}, []);'],
    ['useEffect(() =>', '}, [activeVehicleId, end, start]);'],
    ['const selectedSession =', ');'],
    ['const curveData =', ');'],
  ]) assert.equal(slice(current, start, end), slice(original, start, end));
  for (const specialist of ['SessionCurveChart', 'SessionDetailPanel', 'SessionComparisonChart',
    'ChargerTypeChart', 'SpeedTrendChart', 'TimeToChargeSection',
    'AIChargingCurveFingerprintClustering', 'AIMLChargingCurveClustering']) {
    assert.match(current, new RegExp(`<${specialist}\\b`));
  }
  assert.match(current, /data-tour="charging-curve"/);
  assert.match(current, /query=\{sessionsQuery\}/);
  assert.match(current, /sourceState\.isRefreshing/);
  assert.doesNotMatch(current, /loading=\{|error=\{|empty=\{|RangePicker|VehicleSelect|\bfetch\(/);
});

const preservedPaths = [
  'web/src/api/hooks/useCharging.ts', 'web/src/api/client.ts', 'web/src/api/dataState.ts',
  'web/src/api/types.ts', 'web/src/hooks/useRangeState.ts', 'web/src/hooks/useSelectedVehicle.ts',
  'web/src/components/ai/AIChargingCurveFingerprintClustering.tsx',
  'web/src/components/ai/AIMLChargingCurveClustering.tsx',
  ...fs.readdirSync(path.join(baseline, 'web/src/features/charging/components/charging-curve'))
    .map(file => `web/src/features/charging/components/charging-curve/${file}`),
];
check('All existing private specialists/tests, source hook/client/types and scope dependencies preserve bytes', () => {
  preservedPaths.forEach(relative => assert.equal(
    hash(fs.readFileSync(path.join(root, relative))),
    hash(fs.readFileSync(path.join(baseline, relative))), relative,
  ));
});
check('Existing charging hook route and inherited guarded AI router mounts exist', () => {
  const router = read('internal/api/router.go');
  assert.match(router, /r\.Route\("\/charging",[\s\S]*?r\.Get\("\/", chargingHandler\.ListByVehicle\)/);
  assert.match(read('web/src/api/hooks/useCharging.ts'), /request<ApiChargingSession\[\]>\(`\/charging\?\$\{params\}`/);
  assert.match(router, /mountAIRoutes\(r, aiGuard/);
  assert.match(router, /ChargingCurveClustering:\s+aiChargingCurveClusteringHandler/);
  assert.match(router, /MLChargingCurveClustering:\s+aiMLChargingCurveClusteringHandler/);
  const leaves = read('internal/api/ai_routes.go');
  assert.match(leaves, /r\.Post\("\/charging\/curves\/clusters\/explain"/);
  assert.match(leaves, /r\.Post\("\/ml\/charging-curves\/cluster"/);
});

function loadPure(relative) {
  const code = ts.transpileModule(read(relative), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports, Date, Number }, { filename: relative });
  return exports;
}
check('Pure availability preserves real zero, marks missing/nonfinite/SOC/incomplete duration and never mutates rows', () => {
  const { chargingAvailability } = loadPure(
    'web/src/features/charging/components/charging-curve-modernization/availability.ts');
  const row = Object.freeze({
    total_energy_added_wh: 0, peak_power_w: 0, cost_decimal: 0,
    start_soc_pct: 0, end_soc_pct: 80,
    started_at: '2024-01-01T10:00:00Z', ended_at: '2024-01-01T10:01:00Z',
  });
  const rows = Object.freeze([row]);
  const complete = chargingAvailability(rows);
  for (const key of ['count', 'energy', 'power', 'cost', 'duration', 'soc']) assert.equal(complete[key], 1);
  assert.equal(complete.partial, false);
  const missing = chargingAvailability([{ ...row, total_energy_added_wh: null, peak_power_w: NaN,
    cost_decimal: undefined, ended_at: null, end_soc_pct: Infinity }]);
  for (const key of ['energy', 'power', 'cost', 'duration', 'soc']) assert.equal(missing[key], 0);
  assert.equal(missing.partial, true);
  assert.equal(chargingAvailability([]).partial, false);
  const mixed = chargingAvailability([row, { ...row, ended_at: 'bad', peak_power_w: null }]);
  assert.equal(mixed.count, 2);
  assert.equal(mixed.power, 1);
  assert.equal(mixed.duration, 1);
  assert.equal(mixed.partial, true);
});
check('Real data-state derivation retains arrays on error/paused and distinguishes empty/partial/initial/fatal', () => {
  const { deriveDataState } = loadPure('web/src/api/dataState.ts');
  const data = [{ id: 101 }];
  const retained = deriveDataState({ data, isError: true, error: new Error('refresh') });
  assert.equal(retained.data, data);
  assert.equal(retained.status, 'stale');
  assert.equal(retained.fatalError, null);
  assert.equal(deriveDataState({ data, fetchStatus: 'paused' }).status, 'stale');
  assert.equal(deriveDataState({ data }, { partial: true }).status, 'partial');
  assert.equal(deriveDataState({ data: [] }, { unavailable: true }).status, 'unavailable');
  assert.equal(deriveDataState({}).status, 'initial');
  assert.equal(deriveDataState({ isError: true, error: 'fatal' }).status, 'initialFailure');
});
check('Shared placement preserves ordering with complete phone/tablet/desktop/wide rows', () => {
  const { packCardRows } = loadPure('web/src/components/layout/layout-reference/layoutPolicy.ts');
  for (const width of [320, 375, 390, 430, 768, 1024, 1280, 1440, 1920, 2560]) {
    const hero = Array.from(packCardRows(['half', 'third'], width));
    assert.deepEqual(hero, width < 640 ? [1, 1] : width < 1024 ? [6, 6] : [7, 5]);
    assert.deepEqual(Array.from(packCardRows(['half', 'half'], width)),
      width < 640 ? [1, 1] : [6, 6]);
  }
});
check('Every new production file parses; no raw form/table, inline styles, direct engine or query URLs', () => {
  const owned = [pagePath, ...fs.readdirSync(__dirname).filter(file =>
    /\.(ts|tsx)$/.test(file) && !file.includes('.test.'))
    .map(file => `web/src/features/charging/components/charging-curve-modernization/${file}`)];
  owned.forEach(relative => {
    const source = read(relative);
    const parsed = ts.createSourceFile(relative, source, ts.ScriptTarget.Latest, true);
    assert.equal(parsed.parseDiagnostics.length, 0, relative);
    assert.doesNotMatch(source, /<(button|input|textarea|select|table)\b|style=\{\{|from ['"](recharts|react-leaflet|framer-motion)['"]|[?&]vehicleId=|\/api\/v1\//);
  });
  assert.match(current, /<PageLayout/);
  assert.match(current, /<CardGrid/);
  assert.match(read('web/src/features/charging/components/charging-curve-modernization/CurveSummary.tsx'), /<StatStrip/);
  const before = original.split(/\r?\n/).length;
  const after = current.split(/\r?\n/).length;
  assert.ok(after >= before * 0.7, `page lines ${after} must be >=70% of ${before}`);
});
fs.writeFileSync(path.join(artifact, 'source-pure-check.receipt.json'),
  JSON.stringify({ scope: 'Node source/pure only; React/browser NOTRUN', receipts }, null, 2));
console.log(`Completed ${receipts.length} source/pure checks. No runtime/visual coverage claimed.`);
