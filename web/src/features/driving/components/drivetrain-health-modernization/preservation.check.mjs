/**
 * Offline Node source/pure check, deliberately NOT a normal Vitest test.
 * It never loads the application, makes requests, or writes artifacts.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(directory, '../../../../../..');
const require = createRequire(path.join(root, 'web/package.json'));
const ts = require('typescript');
const loadPure = (file, dependencies = {}) => {
  const source = fs.readFileSync(file, 'utf8');
  const result = ts.transpileModule(source, {
    fileName: file,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    reportDiagnostics: true,
  });
  assert.equal(result.diagnostics.length, 0, `${file}: syntax diagnostics`);
  const module = { exports: {} };
  const context = { module, exports: module.exports, require: id => {
    assert.ok(Object.hasOwn(dependencies, id), `Unexpected pure-check dependency: ${id}`);
    return dependencies[id];
  }};
  vm.runInNewContext(result.outputText, context, { filename: file });
  return module.exports;
};
const constants = loadPure(path.join(directory, '../drivetrain-health/constants.ts'));
const model = loadPure(path.join(directory, 'model.ts'), {
  '../drivetrain-health/constants': constants,
});
const trust = loadPure(path.join(root, 'web/src/api/dataState.ts'));
let count = 0;
const check = (name, run) => { run(); count++; console.log(`PASS ${name}`); };
const equal = (actual, expected) => assert.deepEqual(JSON.parse(JSON.stringify(actual)), expected);
const health = { frontMotorTempC: 0, rearMotorTempC: null, inverterTempC: null, batteryTempC: null, motorStatus: 'Idle', overallHealth: 'good' };

check('four sensors, order and exact ceilings', () => {
  equal(model.sensorsFor(undefined).map(row => [row.key, row.maxTemp, row.value]), [
    ['frontMotor', 150, null], ['rearMotor', 150, null], ['inverter', 120, null], ['battery', 60, null],
  ]);
});
check('real 0 establishes evidence; missing/all-null has no invented score', () => {
  assert.equal(model.healthScore(health), 95);
  assert.equal(model.healthScore(undefined), null);
  assert.equal(model.healthScore({ ...health, frontMotorTempC: null }), null);
  assert.equal(model.healthScore({ ...health, overallHealth: 'invalid' }), null);
});
check('all specialist score/status cases', () => {
  for (const [status, expected] of [['good', 95], ['warning', 60], ['critical', 25]]) {
    assert.equal(model.healthScore({ ...health, overallHealth: status }), expected);
  }
});
check('65%/85% thresholds and nonfinite/null guard', () => {
  assert.equal(model.temperatureBand(97.49, 150), 'good');
  assert.equal(model.temperatureBand(97.5, 150), 'warning');
  assert.equal(model.temperatureBand(127.5, 150), 'critical');
  for (const value of [null, NaN, Infinity]) assert.equal(model.temperatureBand(value, 150), 'unknown');
  assert.equal(model.temperatureBand(0, 0), 'unknown');
  assert.equal(model.temperatureBand(0, 150), 'good');
});
check('range filter, chronological sort, exact 30 cap, input not mutated', () => {
  const input = Array.from({ length: 40 }, (_, index) => ({
    startTs: `2026-09-${String(index % 20 + 1).padStart(2, '0')}T12:00:00`,
    avgPowerW: index, outsideTempAvgC: 0, distanceM: 0,
  })).reverse();
  const before = JSON.stringify(input);
  const rows = model.driveSeries(input, '2026-09-01', '2026-09-30', value => value);
  assert.equal(rows.length, 30);
  assert.ok(rows.every((row, index) => index === 0 || row.date >= rows[index - 1].date));
  assert.equal(JSON.stringify(input), before);
  assert.equal(model.driveSeries(input, '2026-10-01', '2026-10-02', value => value).length, 0);
});
check('drive fields: null vs zero; no fabricated per-drive regen', () => {
  const rows = model.driveSeries([
    { startTs: '2026-09-01T12:00:00', avgPowerW: 0, outsideTempAvgC: 0, distanceM: 0 },
    { startTs: '2026-09-02T12:00:00', avgPowerW: null, outsideTempAvgC: null, distanceM: null },
  ], '2026-09-01', '2026-09-30', value => value);
  equal(rows.map(row => [row.powerMax, row.powerMin, row.outsideTemp, row.distance]), [
    [0, null, 0, 0], [null, null, null, null],
  ]);
  equal(model.powerSummary(rows), { peakPower: 0, avgPowerMax: null, minRegenPower: null });
  equal(model.powerSummary([{ powerMax: 2000 }, { powerMax: 4000 }]), { peakPower: 4000, avgPowerMax: 3000, minRegenPower: null });
});
check('motor mapping: exact aliases, front/rear nullish fallback and source order', () => {
  const rows = model.motorSeries([
    { ts: 'first', motor_temp_c_front: 0, motor_temp_c_rear: 1, inverter_temp_c: 2, torque_nm_front: 0, torque_nm_rear: 50, motor_rpm_front: 0, motor_rpm_rear: 80 },
    { ts: 'second', motor_temp_c_front: null, motor_temp_c_rear: null, inverter_temp_c: null, torque_nm_front: null, torque_nm_rear: -30, motor_rpm_front: null, motor_rpm_rear: -40 },
  ], value => `T:${value}`);
  equal(rows, [
    { time: 'T:first', stator: 0, statorRel: 1, statorRer: 2, torque: 0, speed: null, axle: 0 },
    { time: 'T:second', stator: null, statorRel: null, statorRer: null, torque: -30, speed: null, axle: -40 },
  ]);
});
check('verified stats km/kmh boundary and motor kW exception', () => {
  equal(model.statsSI({ totalDistanceKm: 2, avgSpeedKmh: 36, topSpeedKmh: 0 }), { distance: 2000, avgSpeed: 10, topSpeed: 0 });
  equal(model.statsSI(undefined), { distance: null, avgSpeed: null, topSpeed: null });
  assert.equal(model.motorPowerSI(0), 0);
  assert.equal(model.motorPowerSI(null), null);
  assert.equal(model.motorPowerSI(2), 2000);
});
check('fatal source error vs retained refresh error; neighbor records survive', () => {
  const rows = [{ powerMax: 0 }];
  const retained = trust.deriveDataState({ data: rows, error: new Error('failed'), isError: true });
  assert.equal(retained.data, rows);
  assert.equal(retained.fatalError, null);
  assert.ok(retained.refreshError);
  assert.equal(retained.status, 'stale');
  const fatal = trust.deriveDataState({ error: new Error('failed'), isError: true });
  assert.ok(fatal.fatalError);
  assert.equal(fatal.hasData, false);
});
const page = fs.readFileSync(path.join(root, 'web/src/features/driving/pages/DrivetrainHealthPage.tsx'), 'utf8');
check('exact original hook calls/defaults/range preference and no duplicate controls', () => {
  for (const text of [
    'useDrivetrainHealth(vehicleIdStr)', 'useDrives(vehicleIdStr)', 'useDrivingStats(vehicleIdStr)',
    'useMotorLatest(vehicleId ?? 0, 5_000)', 'useMotorHistory(vehicleId ?? 0, 200)',
    'useVehicleLive(vehicleId ?? undefined)', "persistKey: 'drivetrain-health.range'",
  ]) assert.ok(page.includes(text), text);
  assert.doesNotMatch(page, /<(RangePicker|DateRangeFilter|VehicleSelect)\b/);
  assert.doesNotMatch(page, /empty=\{!|error=\{healthQuery\.error/);
});
check('all original sections, chart preference IDs, series and reference thresholds', () => {
  for (const name of ['HealthSummary', 'ThermalPanels', 'LiveMotorPanel', 'ChartPanels', 'HistoryRecords', 'DetailPanels']) {
    assert.ok(page.includes(`<${name}`), name);
  }
  const charts = ['StatorHistory.tsx', 'TorqueHistory.tsx', 'TemperatureHistory.tsx', 'PowerHistory.tsx']
    .map(file => fs.readFileSync(path.join(directory, file), 'utf8')).join('\n');
  for (const name of ['stator', 'statorRel', 'statorRer', 'torque', 'outsideTemp', 'powerMax', 'powerMin']) {
    assert.ok(charts.includes(`dataKey="${name}"`), name);
  }
  for (const text of ["useHiddenSeries('stator-temp-chart')", "useHiddenSeries('drivetrain-power-output')", 'y={60}', 'y={80}', 'y={35}', 'y={0}']) {
    assert.ok(charts.includes(text), text);
  }
  const frame = fs.readFileSync(path.join(directory, 'PreservedChartFrame.tsx'), 'utf8');
  assert.ok(frame.includes('<ChartContainer'));
  assert.doesNotMatch(frame, /exportable=\{false\}|fullscreen=\{false\}|variant="embedded"/);
});
check('all nine recommendations and urgency ordering survive', () => {
  const source = fs.readFileSync(path.join(directory, 'RecommendationsPanel.tsx'), 'utf8');
  const keys = ['critical-stop', 'service-urgent', 'reduce-load', 'check-coolant', 'avoid-supercharging', 'regular-service', 'gentle-accel', 'precondition', 'monitor-temps'];
  let previous = -1;
  for (const key of keys) { const index = source.indexOf(`key: '${key}'`); assert.ok(index > previous, key); previous = index; }
});
console.log(`Offline preservation checks: ${count} passed. Mounted/runtime checks are NOTRUN.`);
