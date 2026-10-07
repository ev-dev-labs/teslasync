/* Source-only, in-memory checks. Not Vitest, a typecheck, or runtime acceptance. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const web = path.resolve(__dirname, '../../../../..');
const localRequire = createRequire(path.join(web, 'package.json'));
const ts = localRequire('typescript');
const artifacts = 'C:\\Users\\AtulM\\.copilot\\session-state\\bba4960d-f516-4831-bda3-877640f907ce\\files\\parallel-efficiency-page-live';
const page = path.join(web, 'src/features/driving/pages/EfficiencyPage.tsx');
const original = fs.readFileSync(path.join(artifacts, 'originals/EfficiencyPage.tsx'), 'utf8');
const current = fs.readFileSync(page, 'utf8');
const files = [page, ...fs.readdirSync(__dirname).filter(n => /\.tsx?$/.test(n)).map(n => path.join(__dirname, n))];
for (const file of files) {
  const result = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    fileName: file, reportDiagnostics: true,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  });
  assert.equal((result.diagnostics ?? []).filter(d => d.category === ts.DiagnosticCategory.Error).length, 0, file);
}
const cache = new Map();
function load(file) {
  if (cache.has(file)) return cache.get(file);
  const module = { exports: {} };
  cache.set(file, module.exports);
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const resolve = name => {
    // Only date labels are deterministic stubs; real unit and eligibility math is loaded.
    if (name === '@/lib/dateFormat' || name === './dateFormat') return {
      formatDateShort: date => date.slice(0, 10), ymdInTz: date => date.slice(0, 10),
    };
    const target = name.startsWith('@/') ? path.join(web, 'src', name.slice(2))
      : name.startsWith('.') ? path.resolve(path.dirname(file), name) : null;
    if (target) return load(`${target}.ts`);
    return localRequire(name);
  };
  vm.runInNewContext(`(function(require,module,exports){${code}\n})`, {})(resolve, module, module.exports);
  cache.set(file, module.exports);
  return module.exports;
}
const model = load(path.join(__dirname, 'model.ts'));
const aggregation = load(path.join(web, 'src/lib/drivesAggregation.ts'));
const state = load(path.join(web, 'src/api/dataState.ts'));
const prefs = { distance: 'km', speed: 'km/h', temperature: '°C', pressure: 'bar',
  energy: 'kWh', duration: 'h', power: 'kW', locale: 'en-US', precision: 2 };
const row = { id: 1, startTs: '2026-10-02T12:00:00Z', distanceM: 50000,
  energyUsedWh: 7500, avgSpeedMps: 20, outsideTempAvgC: 25 };
const rows = [0, 1, 2, 3].map(id => ({ ...row, id }));
const km = model.buildEfficiencyModel(rows, prefs);
const mi = model.buildEfficiencyModel(rows, { ...prefs, distance: 'mi', speed: 'mph', temperature: '°F' });
assert.equal(km.dailyTrend.length, 4);
assert.equal(km.dailyTrend[0].efficiency, 150);
assert.equal(mi.dailyTrend[0].efficiency, 241);
assert.equal(km.tempBuckets[0].totalDist, 200000);
assert.equal(km.toDistanceDisplay(km.tempBuckets[0].totalDist), 200);
assert.equal(km.toSpeedDisplay(km.tempBuckets[0].avgSpeed), 72);
assert.ok(Math.abs(mi.toDistanceDisplay(mi.tempBuckets[0].totalDist) - 124.27423844746679) < 1e-8);
assert.equal(mi.tempBuckets[0].range, '68–86°F');
assert.equal(km.toStatsDistanceDisplay(5000), 5000);
assert.ok(Math.abs(km.toStatsSpeedDisplay(60) - 60) < 1e-8);
assert.ok(Math.abs(mi.toStatsSpeedDisplay(60) - 37.28227153424) < 1e-8);
assert.equal(aggregation.getEfficiency({ ...row, energyUsedWh: 0 }), null);
assert.equal(aggregation.getEfficiency({ ...row, distanceM: 999 }), null);
assert.equal(model.buildEfficiencyModel([{ ...row, avgSpeedMps: 0, outsideTempAvgC: 0 }], prefs).speedVsEff[0].speed, 0);
assert.equal(model.buildEfficiencyModel([{ ...row, avgSpeedMps: null }], prefs).tempBuckets[0].avgSpeed, null);
assert.equal(model.buildEfficiencyModel([{ ...row, outsideTempAvgC: undefined }], prefs).tempVsEff.length, 0);
assert.equal(model.buildEfficiencyModel([{ ...row, avgSpeedMps: NaN }], prefs).speedVsEff.length, 0);
assert.equal(model.buildEfficiencyModel(rows, prefs, '2026-10-02T12:00:00Z', '2026-10-02T12:00:00Z').dailyTrend.length, 0);
assert.equal(model.buildEfficiencyModel([{ ...row, startTs: 'invalid' }], prefs).dailyTrend[0].date, '—');
assert.equal(model.buildEfficiencyModel(Array.from({ length: 40 }, (_, id) => ({ ...row, id })), prefs).dailyTrend.length, 30);
assert.equal(model.inspectStats({ totalDistanceKm: 0 }).partial, true);
assert.equal(model.inspectStats([]).valid, false);
assert.equal(model.inspectDrives({ rows }).valid, false);
assert.equal(model.inspectDrives([null, row]).rows.length, 1);
assert.equal(model.inspectDrives([null, row]).partial, true);
assert.equal(model.finite('0'), false);
assert.equal(model.finite(0), true);
assert.equal(model.finite(Infinity), false);
assert.equal(model.buildEfficiencyModel([{ ...row, avgSpeedMps: 1e308 }], prefs).speedVsEff.length, 0);
const overflow = model.buildEfficiencyModel([
  { ...row, distanceM: 1000, energyUsedWh: 1e308 },
  { ...row, distanceM: 1000, energyUsedWh: 1e308 },
], prefs);
assert.equal(overflow.tempBuckets[0].avgEff, null);
assert.equal(overflow.speedDist.length, 0);
const retained = state.deriveDataState({ data: rows, error: new Error('refresh') }, { provenance: 'historical' });
assert.equal(retained.status, 'stale');
assert.equal(retained.data, rows);
assert.equal(retained.fatalError, null);
assert.ok(retained.refreshError);
assert.ok(state.deriveDataState({ error: new Error('initial') }).fatalError);
assert.equal(state.deriveDataState({}).provenance, 'unknown');
assert.equal(state.deriveDataState({ data: [] }, { unavailable: true }).status, 'unavailable');
assert.equal(state.deriveDataState({ data: rows, fetchStatus: 'paused' }).isRefreshBlocked, true);
const metrics = load(path.join(__dirname, 'metrics.ts'));
const stats = { totalDrives: 42, totalDistanceKm: 5000, totalDurationS: 360000,
  avgEfficiencyWhKm: 200, avgSpeedKmh: 60, topSpeedKmh: 120, regenRatio: 0.5,
  regenEnergyWh: 12000, co2SavedKg: 300 };
const units = { unitPrefs: prefs, formatEnergy: n => `${n / 1000} kWh` };
const t = (_key, fallback) => fallback;
const m = metrics.efficiencyMetrics({ stats, model: km, units }, t, String, String);
assert.equal(m.kpis.length, 8);
assert.equal(m.insights.length, 6);
assert.equal(m.cost, 0.024);
assert.equal(m.economy, '5');
assert.equal(m.kpis[0].rawValue, 0.2); // Wh/m boundary input, not wire rename.
assert.equal(m.kpis[2].rawValue, 60 * 1000 / 3600);
assert.equal(m.insights[1].rawValue, 50);
const missing = metrics.efficiencyMetrics({ stats: {}, model: km, units }, t, String, String);
assert.ok(missing.kpis.every(metric => metric.rawValue === null));
assert.ok(missing.insights.every(metric => metric.rawValue === null));
const zero = metrics.efficiencyMetrics({ stats: Object.fromEntries(Object.keys(stats).map(k => [k, 0])), model: km, units }, t, String, String);
assert.equal(zero.kpis[7].rawValue, 0);
assert.equal(zero.insights[0].rawValue, '0 kWh');
assert.equal(zero.insights[1].rawValue, 0);
assert.equal(zero.cost, null); // Preserve original positive-distance estimate prerequisite.
for (const hook of ['useDrivingStats(vehicleIdStr)', 'useDrives(vehicleIdStr)']) {
  assert.ok(original.includes(hook) && current.includes(hook), hook);
}
assert.ok(current.includes("persistKey: 'efficiency.range'"));
assert.ok(current.includes('query={[statsQuery, drivesQuery]}'));
assert.ok(current.includes('route="/efficiency"'));
for (const helper of ['efficiencyColor', 'getEfficiency']) assert.ok(current.includes(`export { ${helper} }`));
const productionFiles = files.filter(f => !f.endsWith('.test.tsx') && !f.endsWith('fixtures.ts'));
const closure = productionFiles.map(f => fs.readFileSync(f, 'utf8')).join('\n');
const translationKeys = text => new Set([...text.matchAll(/\bt\(\s*['"]([^'"]+)['"]/g)].map(m => m[1]));
const currentKeys = translationKeys(closure);
for (const key of translationKeys(original)) assert.ok(currentKeys.has(key), `Original user-visible identity: ${key}`);
for (const key of ['range', 'count', 'avgEff', 'kmPerKwh', 'totalDist', 'avgSpeed']) {
  assert.ok(original.includes(`key: '${key}'`) && closure.includes(`key: '${key}'`), key);
}
for (const field of ['totalDrives', 'totalDistanceKm', 'totalDurationS', 'avgEfficiencyWhKm', 'avgSpeedKmh',
  'topSpeedKmh', 'regenRatio', 'regenEnergyWh', 'co2SavedKg', 'startTs', 'distanceM', 'avgSpeedMps', 'outsideTempAvgC']) {
  assert.ok(original.includes(field) && closure.includes(field), field);
}
assert.equal((current.match(/<section\b/g) ?? []).length, 4);
assert.ok(closure.includes('chartId: \'efficiency-daily-trend\''));
assert.ok(closure.includes('driving:efficiency-temp-buckets'));
assert.equal((current.match(/<EfficiencyScatter\b/g) ?? []).length, 2);
assert.equal((closure.match(/<Area\b/g) ?? []).length, 1);
assert.equal((closure.match(/<Bar\b/g) ?? []).length, 1);
assert.equal((closure.match(/<Scatter\b/g) ?? []).length, 1); // Two typed presenter instances.
console.log('PASS: scoped transpile syntax (not typecheck); real SI/legacy bridges, range, eligibility, zero/missing/malformed, retained/fatal/offline, 8+6 metric identities, 4 sections, 4 chart instances, 6 columns and preserved helper/query/preference/action IDs.');
console.log(JSON.stringify({ productionFiles: productionFiles.length,
  originalLines: original.split(/\r?\n/).length, closureLines: closure.split(/\r?\n/).length,
  sections: 4, kpis: 8, insights: 6, gauge: 1, bars: 4, charts: 4, tables: 1, tableColumns: 6 }, null, 2));
