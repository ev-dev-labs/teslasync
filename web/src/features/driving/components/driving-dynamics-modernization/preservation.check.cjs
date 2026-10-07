/** Offline source/pure checks only. Deliberately NOT *.test.* (no Vitest discovery).
 * The immutable baseline is the pre-edit CURRENT working-tree capture, not HEAD.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const repo = 'F:/github/TeslaSync';
const artifact = 'C:/Users/AtulM/.copilot/session-state/bba4960d-f516-4831-bda3-877640f907ce/files/parallel-driving-dynamics-page-live';
const ts = require(path.join(repo, 'web/node_modules/typescript'));
const pagePath = 'web/src/features/driving/pages/DrivingDynamicsPage.tsx';
const oldRoot = 'web/src/features/driving/components/driving-dynamics/';
const newRoot = 'web/src/features/driving/components/driving-dynamics-modernization/';
const current = relative => fs.readFileSync(path.join(repo, relative), 'utf8');
const original = relative => fs.readFileSync(path.join(artifact, 'originals', relative), 'utf8');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const page = current(pagePath);
const baseline = original(pagePath);
const production = fs.readdirSync(__dirname).filter(name => /\.tsx?$/.test(name) && !name.includes('.test.'));
let checks = 0;
function check(name, fn) { fn(); checks++; console.log(`PASS ${name}`); }
function parse(text, name = 'source.tsx') {
  return ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true,
    name.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
}
function nodes(text, predicate) {
  const result = [];
  const file = parse(text);
  function visit(node) { if (predicate(node)) result.push(node); ts.forEachChild(node, visit); }
  visit(file); return result;
}
function compact(text) { return text.replace(/\s+/g, ''); }
const presenters = ['DynamicsTripToolbar', 'RideOverview', 'PowertrainSummary', 'SummaryStats',
  'MotorEfficiencyInsights', 'MotorHistoryCharts', 'DrivingTips', 'LiveMotorStatus',
  'PedalUsage', 'GrokDynamicsBriefing', 'SpeedGearPanel', 'GForcePanel', 'AutopilotSection',
  'DrivingCoachSection', 'DriveAnalyticsSection'];
const migrated = ['DynamicsTripToolbar', 'RideOverview', 'PowertrainSummary', 'SummaryStats',
  'MotorHistoryCharts', 'DrivingTips', 'LiveMotorStatus', 'PedalUsage', 'SpeedGearPanel', 'GForcePanel'];
const retained = presenters.filter(name => !migrated.includes(name));
const oldClosure = [baseline, ...presenters.map(name => original(`${oldRoot}${name}.tsx`)),
  original(`${oldRoot}helpers.ts`), original(`${oldRoot}pickDynamicsDrive.ts`), original(`${oldRoot}useMotorStats.ts`)];
const liveClosure = [page, ...presenters.map(name => current(`${migrated.includes(name) ? newRoot : oldRoot}${name}.tsx`)),
  current(`${oldRoot}helpers.ts`), current(`${oldRoot}pickDynamicsDrive.ts`),
  current(`${newRoot}useMotorEvidence.ts`), current(`${newRoot}DynamicsPlacement.tsx`),
  current(`${newRoot}LiveSourceWarnings.tsx`), current(`${newRoot}SignedMotorReading.tsx`)];
const lines = texts => texts.reduce((sum, text) => sum + text.split('\n').length, 0);
check('all 15 presenter sections remain mounted; four group shells remain', () => {
  const rendered = nodes(page, n => ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)).map(n => n.tagName.getText());
  for (const name of presenters) assert.equal(rendered.filter(n => n === name).length, 1, name);
  assert.equal(rendered.filter(n => n === 'section').length, 4);
  assert.ok(page.includes('<PageLayout'));
  assert.ok(!page.includes('empty={!'));
});
check('closure lines >=70% of CURRENT original, not shared-library padding', () => {
  assert.ok(lines(liveClosure) >= lines(oldClosure) * 0.7);
  console.log(`  original=${lines(oldClosure)} current=${lines(liveClosure)} ratio=${(lines(liveClosure) / lines(oldClosure)).toFixed(3)} page=${page.split('\n').length}`);
});
check('retained complex sources/helpers are byte-for-byte unchanged', () => {
  for (const name of [...retained.map(n => `${n}.tsx`), 'helpers.ts', 'pickDynamicsDrive.ts', 'useMotorStats.ts', 'grokDynamics.ts']) {
    assert.deepEqual(fs.readFileSync(path.join(repo, oldRoot, name)), fs.readFileSync(path.join(artifact, 'originals', oldRoot, name)), name);
  }
});
check('all original private component bytes remain untouched', () => {
  for (const name of fs.readdirSync(path.join(artifact, 'originals', oldRoot)).filter(n => /\.(tsx?|md)$/.test(n))) {
    assert.deepEqual(fs.readFileSync(path.join(repo, oldRoot, name)), fs.readFileSync(path.join(artifact, 'originals', oldRoot, name)), name);
  }
});
check('SSE field arrays and binding/query keys are unchanged', () => {
  for (const name of ['MOTOR_SIGNAL_FIELDS', 'DRIVE_DYNAMICS_SIGNAL_FIELDS', 'CRUISE_SIGNAL_FIELDS']) {
    const initializer = text => nodes(text, n => ts.isVariableDeclaration(n) && n.name.getText() === name)[0].initializer.getText();
    assert.equal(initializer(page), initializer(baseline));
  }
  const call = text => nodes(text, n => ts.isCallExpression(n) && n.expression.getText() === 'useSignalQueryInvalidation')[0].getText();
  assert.equal(call(page), call(baseline));
});
check('range/default/URL/drive merge/both bounds/history enablement and poll policy unchanged', () => {
  for (const name of ['useRangeState', 'useDrives', 'useUrlString']) {
    const calls = text => nodes(text, n => ts.isCallExpression(n) && n.expression.getText() === name).map(n => n.getText());
    assert.deepEqual(calls(page), calls(baseline));
  }
  for (const name of ['filteredDrives', 'selectedDrive', 'historyQuery']) {
    const declaration = text => nodes(text, n => ts.isVariableDeclaration(n) && n.name.getText() === name)[0].getText();
    assert.equal(declaration(page), declaration(baseline));
  }
  assert.ok(page.includes('showPerDriveScores={false}'));
  assert.ok(!/RangePicker|DateRangeFilter|VehicleSelect/.test(page));
  const queryArgs = text => nodes(text, n => ts.isCallExpression(n) && n.expression.getText() === 'useMotorHistory')[0].arguments.map(n => compact(n.getText()));
  const before = queryArgs(original(`${oldRoot}useMotorStats.ts`));
  const after = queryArgs(current(`${newRoot}useMotorEvidence.ts`));
  assert.equal(after[0], before[0]);
  assert.equal(after[1], before[1]);
});
check('all seven motor history raw fields, six series, axes, legend identities and export contracts retained', () => {
  const before = original(`${oldRoot}MotorHistoryCharts.tsx`);
  const after = current(`${newRoot}MotorHistoryCharts.tsx`);
  const charts = text => nodes(text, n => (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) &&
    ['ChartContainer', 'Area', 'Line', 'XAxis', 'YAxis', 'ChartLegend', 'ChartGradient'].includes(n.tagName.getText()));
  const attrs = node => node.attributes.properties
    .filter(n => !['loading', 'error', 'onRetry'].includes(n.name?.getText()))
    .map(n => compact(n.getText()));
  assert.deepEqual(charts(after).map(n => [n.tagName.getText(), attrs(n)]), charts(before).map(n => [n.tagName.getText(), attrs(n)]));
  for (const field of ['ts', 'power_kw', 'regen_kw', 'torque_nm_front', 'torque_nm_rear', 'motor_rpm_front', 'motor_rpm_rear']) {
    assert.ok(after.includes(`s.${field}`), field);
  }
  const hidden = text => nodes(text, n => ts.isCallExpression(n) && n.expression.getText() === 'useHiddenSeries').map(n => n.getText());
  assert.deepEqual(hidden(after), hidden(before));
  assert.ok(after.includes('error={state.fatalError}'));
  assert.ok(after.includes('StaleRefreshWarning'));
});
check('every original presenter i18n key and raw field is still reachable in the page closure', () => {
  const keys = text => nodes(text, n => ts.isCallExpression(n) && n.expression.getText() === 't' && ts.isStringLiteral(n.arguments[0]))
    .map(n => n.arguments[0].text);
  const reachable = new Set(liveClosure.flatMap(keys));
  for (const key of oldClosure.flatMap(keys)) assert.ok(reachable.has(key), `lost key ${key}`);
  const rawFields = ['distanceM', 'durationS', 'energyUsedWh', 'regenEnergyWh', 'avgSpeedMps', 'maxSpeedMps',
    'startBatteryPct', 'endBatteryPct', 'startAddress', 'endAddress', 'startTs', 'endTs', 'avgPowerW',
    'torque_nm_front', 'torque_nm_rear', 'motor_rpm_front', 'motor_rpm_rear', 'motor_temp_c_front', 'motor_temp_c_rear',
    'power_kw', 'regen_kw', 'shift_state', 'pedal_position', 'brake_pedal_position', 'brake_pedal_active',
    'lateral_acceleration', 'longitudinal_acceleration', 'speed', 'overall_score', 'total_drives_analyzed',
    'style_breakdown', 'hard_accel_pct', 'hard_brake_pct', 'highway_pct', 'short_trip_pct', 'cold_start_pct'];
  const text = liveClosure.join('\n');
  for (const field of rawFields) assert.ok(new RegExp(`\\b${field}\\b`).test(text), `lost field ${field}`);
  assert.ok(text.includes('to={`/drives/${drive.id}`}'));
  assert.ok(text.includes('id="dynamics-drive"'));
  assert.ok(text.includes('onSelectDrive(event.target.value)'));
});
check('all owned production/test TS sources parse; no prohibited production syntax', () => {
  for (const name of fs.readdirSync(__dirname).filter(n => /\.tsx?$/.test(n))) {
    const source = current(newRoot + name);
    const result = ts.transpileModule(source, { fileName: name, reportDiagnostics: true,
      compilerOptions: { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } });
    assert.deepEqual((result.diagnostics ?? []).filter(d => d.category === ts.DiagnosticCategory.Error), [], name);
  }
  for (const [name, text] of [[pagePath, page], ...production.map(n => [n, current(newRoot + n)])]) {
    assert.equal(parse(text, name).parseDiagnostics.length, 0, name);
    assert.ok(!/<(?:button|input|textarea|select|table)\b/.test(text), `raw controls ${name}`);
    assert.ok(!/style=\{\{|from ['"](?:recharts|react-leaflet|framer-motion)['"]/.test(text), `direct/static style ${name}`);
    assert.ok(!/:\s*any\b|as\s+any\b|text-neon-\w+/.test(text), `unsafe/neon ${name}`);
    assert.ok(!/toDisplayDistance|toDisplayTemperature|convertDistance\(/.test(text), `deprecated units ${name}`);
  }
});
// Run the real pure modules via local TypeScript transpilation only; no React,
// Vitest, API, network, browser, catalog audit, build or install is started.
const moduleCache = new Map();
function load(relative) {
  if (moduleCache.has(relative)) return moduleCache.get(relative);
  const exports = {};
  moduleCache.set(relative, exports);
  const compiled = ts.transpileModule(current(relative), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  const requireLocal = spec => {
    const base = spec.startsWith('@/') ? `web/src/${spec.slice(2)}` : path.posix.normalize(path.posix.join(path.posix.dirname(relative), spec));
    for (const suffix of ['.ts', '/index.ts']) if (fs.existsSync(path.join(repo, base + suffix))) return load(base + suffix);
    throw new Error(`nonlocal pure import ${spec}`);
  };
  new Function('require', 'exports', compiled)(requireLocal, exports);
  return exports;
}
check('real pure physics preserve finite zero/unknown/invalid, signed torque, hottest motor and sample means', () => {
  const { computeMotorStats } = load(`${oldRoot}helpers.ts`);
  assert.equal(computeMotorStats(undefined), null);
  assert.equal(computeMotorStats([]), null);
  const rows = [
    { torque_nm_front: -50, torque_nm_rear: 10, motor_temp_c_front: 20, motor_temp_c_rear: 40, power_kw: 0, regen_kw: 0 },
    { torque_nm_front: null, torque_nm_rear: null, motor_temp_c_front: null, motor_temp_c_rear: null, power_kw: NaN, regen_kw: Infinity },
    { torque_nm_front: 0, torque_nm_rear: 0, motor_temp_c_front: 0, motor_temp_c_rear: 0, power_kw: 100, regen_kw: 20 },
  ];
  const bytes = JSON.stringify(rows);
  assert.deepEqual(computeMotorStats(rows), {
    totalReadings: 3, avgTorque: -20, maxTorque: 0, avgMotorTemp: 20, maxMotorTemp: 40,
    avgPower: 50, peakPower: 100, minPower: 0, peakRegen: 20, highTorquePct: 0,
  });
  assert.equal(JSON.stringify(rows), bytes);
  const unknown = computeMotorStats([{}]);
  assert.equal(unknown.totalReadings, 1);
  for (const [key, value] of Object.entries(unknown)) if (key !== 'totalReadings') assert.equal(value, null);
});
check('real selection helpers retain URL/open/default priority, identity and exclusive last-sample end', () => {
  const { pickDynamicsDrive, mergeOpenDrives, motorWindowForDrive } = load(`${oldRoot}pickDynamicsDrive.ts`);
  const a = { id: 1, startTs: '2026-10-01T10:00:00Z', endTs: '2026-10-01T11:00:00Z' };
  const b = { ...a, id: 2, endTs: null, live: true };
  assert.equal(pickDynamicsDrive([a, b], '1'), a);
  assert.equal(pickDynamicsDrive([a, b]), b);
  assert.equal(pickDynamicsDrive([], '1'), null);
  assert.deepEqual(mergeOpenDrives([a], [b]), [b, a]);
  assert.deepEqual(motorWindowForDrive(a), { start: a.startTs, end: '2026-10-01T11:00:01.000Z' });
  assert.deepEqual(motorWindowForDrive(b, new Date('2026-10-01T12:00:00Z')), { start: a.startTs, end: '2026-10-01T12:00:01.000Z' });
  assert.equal(motorWindowForDrive({ ...a, endTs: 'invalid' }), null);
});
check('real data-state keeps raw identity on refresh failure; independent fatal/loading/offline states', () => {
  const { deriveDataState, knownNumber } = load('web/src/api/dataState.ts');
  const rows = [{ power_kw: 0 }];
  const retained = deriveDataState({ data: rows, isError: true, error: new Error('refresh failed') });
  assert.equal(retained.data, rows); assert.equal(retained.status, 'stale');
  assert.equal(retained.fatalError, null); assert.equal(retained.refreshError.message, 'refresh failed');
  assert.equal(deriveDataState({ isError: true, error: new Error('fatal') }).fatalError.message, 'fatal');
  assert.equal(deriveDataState({ isPending: true, isFetching: true }).status, 'initial');
  assert.equal(deriveDataState({ data: rows, fetchStatus: 'paused' }).isRefreshBlocked, true);
  assert.equal(knownNumber(0), 0); assert.equal(knownNumber(NaN), null); assert.equal(knownNumber(null), null);
});
check('real SI formatters and stats display match existing quantity defaults, locale and preference conversion', () => {
  const units = load('web/src/lib/unitConversion.ts');
  const { formatMetric } = load('web/src/lib/metric-reference/formatMetric.ts');
  for (const locale of ['en-US', 'de-DE']) for (const precision of [undefined, 0, 3]) for (const imperial of [false, true]) {
    const prefs = { distance: imperial ? 'mi' : 'km', speed: imperial ? 'mph' : 'km/h',
      temperature: imperial ? '°F' : '°C', pressure: 'bar', energy: 'kWh', duration: 'h', power: 'kW', locale, precision };
    const mapping = [
      ['distance', 'formatDistance', 1609.344, 1], ['duration', 'formatDuration', 3600, 0],
      ['energy', 'formatEnergy', 2345, 2], ['power', 'formatPower', 42345, 2],
    ];
    for (const [id, formatter, raw, fallback] of mapping) {
      assert.equal(formatMetric(id, raw, { units: prefs, currency: { kind: 'symbol', value: '' } },
        undefined, { precision: precision ?? fallback }).text, units[formatter](raw, prefs));
    }
    assert.equal(units.formatTemperature(0, prefs).includes(imperial ? '32' : '0'), true);
    for (const raw of [null, undefined, NaN, Infinity]) assert.equal(units.formatSpeed(raw, prefs), '—');
    assert.equal(formatMetric('power', 0, { units: prefs }).state, 'value');
    assert.equal(formatMetric('power', null, { units: prefs }).state, 'missing');
    assert.equal(formatMetric('power', Infinity, { units: prefs }).state, 'invalid');
  }
});
check('shared placement keeps source order/full width at all specified widths; no mobile truncation', () => {
  const { containerPolicy, packCardRows } = load('web/src/components/layout/layout-reference/layoutPolicy.ts');
  for (const width of [320, 375, 390, 430, 768, 1024, 1280, 1440, 1920, 2560]) {
    const spans = packCardRows(['third', 'third', 'third'], width);
    assert.equal(spans.length, 3);
    assert.ok(spans.every(n => n > 0 && n <= containerPolicy(width).columns));
  }
  assert.deepEqual(packCardRows(['third', 'third', 'third'], 320), [1, 1, 1]);
  assert.deepEqual(packCardRows(['third', 'third', 'third'], 1920), [4, 4, 4]);
  assert.ok(!liveClosure.join('\n').includes('hidden sm:block'));
});
check('matching real hook routes exist; no request/API/query client or backend changes', () => {
  for (const relative of ['web/src/api/hooks/useDriving.ts', 'web/src/api/hooks/useVehicles.ts', 'web/src/api/hooks/useTelemetry.ts']) {
    assert.equal(sha(fs.readFileSync(path.join(repo, relative))), sha(fs.readFileSync(path.join(artifact, 'originals', relative))), relative);
  }
  const router = current('internal/api/router.go');
  for (const route of ['r.Route("/drives"', 'r.Route("/motor"', 'r.Route("/drive-dynamics"',
    'r.Get("/analytics/driving-coach"', '.Get("/signals/observations"']) assert.ok(router.includes(route), route);
  assert.ok(router.includes('r.Get("/state"'));
  for (const text of liveClosure) {
    const forbidden = nodes(text, n => ts.isCallExpression(n) && ['request', 'fetch'].includes(n.expression.getText()));
    assert.equal(forbidden.length, 0);
    // JSX vehicleId={...} is a typed component prop, not a camel-case URL
    // query parameter. refetch() is likewise not the prohibited fetch().
    assert.ok(!/\/api\/v1|[?&]vehicleId=|new EventSource/.test(text));
  }
});
console.log(`SOURCE/PURE CHECKS PASSED: ${checks}. Presenter/browser/whole-app tests NOTRUN by this check.`);
