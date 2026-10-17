/* Scoped source/pure guard only. NOT a runtime, typecheck or whole-app acceptance test. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const Module = require('node:module');
const root = path.resolve(__dirname, '../../../../../..');
const ts = require(path.join(root, 'web/node_modules/typescript'));
const artifacts = 'C:\\Users\\AtulM\\.copilot\\session-state\\bba4960d-f516-4831-bda3-877640f907ce\\files\\parallel-charging-thermal-tax-page-live';
const original = path.join(artifacts, 'original-current');
const pagePath = 'web/src/features/charging/pages/ChargingThermalTaxPage.tsx';
const specialistPath = 'web/src/features/charging/lib/chargingThermalTax.ts';
const hooksPath = 'web/src/api/hooks/useCharging.ts';
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const hash = buffer => crypto.createHash('sha256').update(buffer).digest('hex');
const files = [pagePath, ...fs.readdirSync(__dirname)
  .filter(name => /\.tsx?$/.test(name) && !name.includes('.test.'))
  .map(name => path.relative(root, path.join(__dirname, name)))];
let assertions = 0;
function check(value, message) { assert.ok(value, message); assertions++; }
for (const relative of [specialistPath, hooksPath]) {
  check(fs.readFileSync(path.join(root, relative)).equals(fs.readFileSync(path.join(original, relative))),
    `Readonly baseline drift: ${relative}`);
}
const sources = files.map(read);
const closure = sources.join('\n');
const oldPage = fs.readFileSync(path.join(original, pagePath), 'utf8');
const originalLines = oldPage.split(/\r?\n/).length;
const productionLines = sources.reduce((count, source) => count + source.split(/\r?\n/).length, 0);
check(productionLines >= originalLines * 0.7, 'Production closure below original preservation floor');
for (const relative of files) {
  const source = read(relative);
  const ast = ts.createSourceFile(relative, source, ts.ScriptTarget.Latest, true,
    relative.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  check(ast.parseDiagnostics.length === 0, `Syntax diagnostics: ${relative}`);
}
const runtimeTestFile = path.join(__dirname, 'ChargingThermalTaxPage.runtime.test.tsx');
const testSource = fs.readFileSync(runtimeTestFile, 'utf8');
check(ts.createSourceFile(runtimeTestFile, testSource, ts.ScriptTarget.Latest, true,
  ts.ScriptKind.TSX).parseDiagnostics.length === 0, 'Authored runtime test syntax diagnostics');
check(testSource.includes("importOriginal<typeof import('@/components/motion')>()")
  && testSource.includes('...actual, FadeIn:'), 'Typed partial motion mock missing');
check(testSource.includes('beforeEach(() => {') && testSource.includes('vi.clearAllMocks();'),
  'Void beforeEach mock reset missing');
check(testSource.includes('return render(<ChargingThermalTaxPage />, { wrapper: Harness })')
  && testSource.includes('result.rerender(<ChargingThermalTaxPage />)'),
  'Persistent real Router rerender harness missing');
for (const call of ['useChargingHistory(vehicleIdStr)', 'useChargeTelemetry(numericSessionId)',
  'analyzeChargingThermalTax(telemetryQuery.data ?? [])']) {
  check(oldPage.includes(call) && closure.includes(call), `Original query/analysis operand absent: ${call}`);
}
for (const key of ['heaterEnergy', 'heaterShare', 'heaterOnTime', 'peakHeater', 'chart', 'detail',
  'coverage', 'phaseOn', 'phaseOff', 'selectSession', 'unknownCharger']) {
  check(closure.includes(`chargingThermalTax.${key}`), `Original visible fact missing: ${key}`);
}
for (const key of ['power_integral', 'cumulative', 'none']) check(closure.includes(key), `Missing provenance: ${key}`);
for (const token of ['height={320}', 'dataKey="heaterW"', 'dataKey="chargeW"', 'fillOpacity={0.35}',
  'strokeWidth={2}', 'dot={false}', 'chartTokens.series[3]', 'chartTokens.series[0]',
  'charging-thermal-tax-power', '<ChartLegend', '<ChartTooltip', '<XAxis', '<YAxis', '<CartesianGrid']) {
  check(closure.includes(token), `Original chart behavior absent: ${token}`);
}
check(!/useHiddenSeries\s*\(/.test(closure), 'Duplicate URL legend controller');
check(closure.includes('useDataState(sessionsQuery') && closure.includes('useDataState(telemetryQuery'), 'Independent data states missing');
check(closure.includes('mobilePresentation={{') && closure.includes('tableId="charging:thermal-tax-phases"'), 'Real DataTable mobile adoption absent');
check(!/\b(?:fetch|request)\s*\(/.test(closure), 'New network/controller introduced');
check(!/\b(?:annotations|fullscreen|exportData|exportable)=/.test(read(path.relative(root, path.join(__dirname, 'ThermalPowerChart.tsx')))),
  'Chart default capability opt-in changed');
const violations = {
  inlineStyles: (closure.match(/style=\{\{/g) ?? []).length,
  rawControls: (closure.match(/<(?:button|input|textarea|select|table)\b/g) ?? []).length,
  directLibraries: (closure.match(/from ['"](?:recharts|react-leaflet|framer-motion)['"]/g) ?? []).length,
  camelQueryParam: (closure.match(/vehicleId=/g) ?? []).length,
};
for (const [name, count] of Object.entries(violations)) check(count === 0, `${name}: ${count}`);
function loadPure(filename) {
  const source = fs.readFileSync(filename, 'utf8');
  const output = ts.transpileModule(source, { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
  } }).outputText;
  const module = new Module(filename);
  module.filename = filename;
  module.paths = Module._nodeModulePaths(path.dirname(filename));
  module._compile(output, filename);
  return module.exports;
}
const presentation = loadPure(path.join(__dirname, 'thermalPresentation.ts'));
const physics = loadPure(path.join(root, specialistPath));
const sample = (ts, heater, ac = 0, dc = 5000, energy = 0) => ({
  ts, battery_heater_power_w: heater, ac_charging_power_w: ac, dc_charging_power_w: dc,
  ac_charging_energy_in_wh: 0, dc_charging_energy_in_wh: energy,
});
const readings = [sample('2026-10-01T00:00:00Z', 1000),
  sample('2026-10-01T00:01:00Z', 1000, 0, 5000, 500),
  sample('2026-10-01T00:02:00Z', 0, 0, 5000, 1000)];
const summary = physics.analyzeChargingThermalTax(readings);
assert.equal(summary.heaterWh, 25);
assert.equal(summary.heaterSharePct, 2.5);
assert.equal(summary.heaterOnS, 120);
assert.equal(summary.dataCoveragePct, 100);
assert.equal(summary.energySource, 'cumulative');
assert.deepEqual(presentation.heaterEvidence(readings), { hasPeak: true, hasIntegral: true, incomplete: false });
assert.deepEqual(presentation.heaterEvidence(readings.map(row => ({ ...row, battery_heater_power_w: null }))),
  { hasPeak: false, hasIntegral: false, incomplete: true });
assert.equal(presentation.heaterEvidence([readings[0], readings[0]]).hasIntegral, false);
const gaps = presentation.thermalPowerRows([
  sample('2026-10-01T00:00:00Z', null, null, null),
  sample('invalid', 1000), sample('2026-10-01T00:01:00Z', 0, -100, 200),
], 'en-US');
assert.equal(gaps.length, 2);
assert.equal(gaps[0].heaterW, null);
assert.equal(gaps[0].chargeW, null);
assert.equal(gaps[1].heaterW, 0);
assert.equal(gaps[1].chargeW, 100);
assert.equal(presentation.phaseHasMissingHeater(summary.phases[0],
  [{ ...readings[0], battery_heater_power_w: null }]), true);
const fallback = physics.analyzeChargingThermalTax(readings.map(row =>
  ({ ...row, ac_charging_energy_in_wh: null, dc_charging_energy_in_wh: null })));
assert.equal(fallback.energySource, 'power_integral');
assert.equal(fallback.heaterWh, summary.heaterWh);
const exactThreshold = physics.analyzeChargingThermalTax([
  sample('2026-10-01T00:00:00Z', 50), sample('2026-10-01T00:01:00Z', 50),
]);
assert.equal(exactThreshold.heaterOnS, 0);
const aboveThreshold = physics.analyzeChargingThermalTax([
  sample('2026-10-01T00:00:00Z', 51), sample('2026-10-01T00:01:00Z', 51),
]);
assert.equal(aboveThreshold.heaterOnS, 60);
assert.equal(physics.analyzeChargingThermalTax([
  sample('2026-10-01T00:00:00Z', 1000), sample('2026-10-01T00:05:00Z', 1000),
]).dataCoveragePct, 100);
assert.equal(physics.analyzeChargingThermalTax([
  sample('2026-10-01T00:00:00Z', 1000), sample('2026-10-01T00:05:01Z', 1000),
]).dataCoveragePct, 0);
assert.equal(physics.analyzeChargingThermalTax([
  readings[0], { ...readings[1], dc_charging_energy_in_wh: 500 },
  { ...readings[2], dc_charging_energy_in_wh: 10 },
]).energySource, 'power_integral');
const router = read('internal/api/router.go');
check(router.includes('r.Route("/charging",') && router.includes('r.Get("/", chargingHandler.ListByVehicle)'),
  'History route missing');
check(router.includes('r.Route("/{sessionID}",') && router.includes('r.Get("/telemetry", chargingHandler.TelemetryReadings)'),
  'Telemetry route missing');
console.log(JSON.stringify({
  status: 'SCOPED_SOURCE_AND_PURE_PASS', sourceAssertions: assertions, pureAssertions: 21,
  originalLines, productionLines, productionPercent: Math.round(productionLines / originalLines * 100),
  sections: { original: 4, current: 4 },
  shellTokenCounts: {
    originalGlassPanelOrChartContainer: (oldPage.match(/GlassPanel|ChartContainer/g) ?? []).length,
    currentGlassPanelOrChartContainer: (closure.match(/GlassPanel|ChartContainer/g) ?? []).length,
    currentLayoutCardOrStatStrip: (closure.match(/LayoutCard|StatStrip/g) ?? []).length,
  },
  violations,
  ownedHashes: files.map(relative => ({ path: relative, sha256: hash(fs.readFileSync(path.join(root, relative))) })),
  limitations: 'Syntax/source/pure checks only. Runtime tests NOTRUN; full tsc/build/Vitest/browser and whole-app acceptance pending parent.',
}, null, 2));
