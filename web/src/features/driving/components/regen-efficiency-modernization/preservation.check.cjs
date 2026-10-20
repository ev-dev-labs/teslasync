/* Offline source/pure checks only. Intentionally NOT a Vitest .test file. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const ts = require(path.resolve(__dirname, '../../../../../node_modules/typescript'));

const repo = path.resolve(__dirname, '../../../../../..');
const artifact = 'C:\\Users\\AtulM\\.copilot\\session-state\\bba4960d-f516-4831-bda3-877640f907ce\\files\\parallel-regen-efficiency-page-live';
const ownedDir = 'web/src/features/driving/components/regen-efficiency-modernization';
const page = 'web/src/features/driving/pages/RegenEfficiencyPage.tsx';
const originalRoot = path.join(artifact, 'originalacquisition');
const slash = value => value.replace(/\\/g, '/');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const read = (file, original = false) => fs.readFileSync(path.join(original ? originalRoot : repo, file), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(originalRoot, 'manifest.json'), 'utf8'));
for (const record of manifest) {
  const bytes = fs.readFileSync(path.join(originalRoot, record.path));
  assert.equal(hash(bytes).toUpperCase(), record.sha256, `immutable acquisition: ${record.path}`);
  if (slash(record.path) !== page) {
    assert.equal(hash(fs.readFileSync(path.join(repo, record.path))).toUpperCase(), record.sha256,
      `read-only source changed: ${record.path}`);
  }
}
const production = [page, ...fs.readdirSync(path.join(repo, ownedDir))
  .filter(name => /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name))
  .map(name => `${ownedDir}/${name}`)];
const ownedTS = [page, ...fs.readdirSync(path.join(repo, ownedDir))
  .filter(name => /\.tsx?$/.test(name)).map(name => `${ownedDir}/${name}`)];
const syntax = [];
for (const file of ownedTS) {
  const result = ts.transpileModule(read(file), {
    fileName: file, reportDiagnostics: true,
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  });
  const errors = (result.diagnostics ?? []).filter(d => d.category === ts.DiagnosticCategory.Error);
  assert.equal(errors.length, 0, ts.formatDiagnosticsWithColorAndContext(errors, {
    getCanonicalFileName: name => name, getCurrentDirectory: () => repo, getNewLine: () => '\n',
  }));
  syntax.push(file);
}
function parsed(file, original = false) {
  return ts.createSourceFile(file, read(file, original), ts.ScriptTarget.Latest, true);
}
function featurePath(value) { return value.startsWith('web/src/features/driving/'); }
function resolveLocal(file, spec, original) {
  if (!spec.startsWith('.')) return null;
  const base = slash(path.posix.normalize(path.posix.join(path.posix.dirname(file), spec)));
  if (!featurePath(base)) return null;
  return [base, `${base}.tsx`, `${base}.ts`, `${base}/index.ts`]
    .find(candidate => fs.existsSync(path.join(original ? originalRoot : repo, candidate)) &&
      fs.statSync(path.join(original ? originalRoot : repo, candidate)).isFile()) ?? null;
}
/** Follow named barrel exports, NOT every unused sibling exported by a barrel.
 * Count every reachable file once. Shared/API/type modules are excluded.
 */
function closure(original) {
  const files = new Set();
  const handled = new Set();
  function visit(file, names = null) {
    const signature = `${file}:${names?.join(',') ?? '*'}`;
    if (handled.has(signature)) return;
    handled.add(signature);
    files.add(file);
    for (const statement of parsed(file, original).statements) {
      if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
        const target = resolveLocal(file, statement.moduleSpecifier.text, original);
        if (!target) continue;
        const bindings = statement.importClause?.namedBindings;
        const requested = bindings && ts.isNamedImports(bindings)
          ? bindings.elements.map(item => (item.propertyName ?? item.name).text) : null;
        visit(target, requested);
      }
      if (ts.isExportDeclaration(statement) && statement.moduleSpecifier &&
          ts.isStringLiteral(statement.moduleSpecifier)) {
        const target = resolveLocal(file, statement.moduleSpecifier.text, original);
        if (!target) continue;
        const exports = statement.exportClause && ts.isNamedExports(statement.exportClause)
          ? statement.exportClause.elements.filter(item => !names || names.includes(item.name.text)) : null;
        if (exports && exports.length === 0) continue;
        visit(target, exports?.map(item => (item.propertyName ?? item.name).text) ?? null);
      }
    }
  }
  visit(page);
  return [...files].sort().map(file => ({
    path: file,
    lines: read(file, original).split(/\r?\n/).length,
    sha256: hash(fs.readFileSync(path.join(original ? originalRoot : repo, file))),
  }));
}
const originalClosure = closure(true);
const currentClosure = closure(false);
const lineSum = files => files.reduce((sum, item) => sum + item.lines, 0);
const originalLines = lineSum(originalClosure);
const currentLines = lineSum(currentClosure);
assert.ok(currentLines >= originalLines * 0.7, `${currentLines}/${originalLines} closure below 70%`);
function translationKeys(files, original) {
  const keys = new Set();
  for (const { path: file } of files) {
    function walk(node) {
      if (ts.isCallExpression(node) && node.expression.getText() === 't' && node.arguments[0] &&
          ts.isStringLiteral(node.arguments[0])) keys.add(node.arguments[0].text);
      ts.forEachChild(node, walk);
    }
    walk(parsed(file, original));
  }
  return keys;
}
const oldKeys = translationKeys(originalClosure, true);
const newKeys = translationKeys(currentClosure, false);
assert.deepEqual([...oldKeys].filter(key => !newKeys.has(key)), [], 'source section/label/help key lost');
function calls(file, name, original) {
  const matches = [];
  function walk(node) {
    if (ts.isCallExpression(node) && node.expression.getText() === name) {
      matches.push(node.getText().replace(/\s/g, ''));
    }
    ts.forEachChild(node, walk);
  }
  walk(parsed(file, original));
  return matches;
}
for (const name of ['useRangeState', 'useRegenEfficiency', 'useDrives', 'buildRegenEfficiencyModel']) {
  assert.deepEqual(calls(page, name, false), calls(page, name, true), `query/default/physics operands: ${name}`);
}
const all = production.map(file => read(file)).join('\n');
const checks = {
  staticInline: /style=\{\{/g,
  rawControls: /<(?:button|input|textarea|select|table)\b/g,
  directLibraries: /from\s+['"](?:recharts|react-leaflet|framer-motion)['"]/g,
  anyType: /:\s*any\b|as\s+any\b/g,
  neonBody: /text-neon-/g,
  duplicateWorkspaceControls: /<(?:RangePicker|VehicleSelect|DateRangeFilter)\b/g,
  localTimersObservers: /setInterval|setTimeout|new ResizeObserver|new MutationObserver/g,
  legacyUnits: /distance_mi|regen_kwh|energy_used_kwh|convertDistance\(/g,
};
const counts = {};
for (const [label, regex] of Object.entries(checks)) {
  counts[label] = [...all.matchAll(regex)].length;
  assert.equal(counts[label], 0, label);
}
const expectedSections = ['regen-kpis', 'regen-overview', 'regen-monthly', 'regen-distribution',
  'regen-temperature', 'regen-soc', 'regen-evidence', 'regen-methodology'];
for (const id of expectedSections) assert.ok(all.includes(`'${id}'`) || all.includes(`"${id}"`), id);
const source = file => read(`${ownedDir}/${file}`);
for (const [file, needles] of [
  ['MonthlyRecoveryTrend.tsx', ['chartKey="regen-monthly-recovery"', 'exportFilename="regen-monthly-recovery"', 'exportData={state.isResolved ? exportRows : []}', "key: 'driveEnergy'", "key: 'eligible'", "key: 'returned'"]],
  ['MonthlyRecoveryChart.tsx', ['chartKey="monthly-recovery"', 'dataKey="recoveredEnergy"', 'dataKey="recoveryRatio"', 'yAxisId="energy"', 'yAxisId="ratio"', 'connectNulls={false}', "hiddenSeries?.isHidden('recoveredEnergy')", "hiddenSeries?.isHidden('recoveryRatio')"]],
  ['RecoveryRatioDistribution.tsx', ['exportFilename="regen-ratio-distribution"', 'dataKey="drives"', "key: 'share'", "case 'from30'"]],
  ['RankedDriveTable.tsx', ['tableId="driving:regen-ranked-evidence"', '`${row.driveId}:${row.rank}`', 'mobilePresentation={{', 'density="compact"']],
]) for (const needle of needles) assert.ok(source(file).includes(needle), `${file}: ${needle}`);
const hook = read('web/src/api/hooks/useDriving.ts');
const router = read('internal/api/router.go');
assert.ok(hook.includes("request<Drive[]>(qs ? `/drives?${qs}` : '/drives', { signal })"));
assert.ok(hook.includes('request<RegenEfficiencyData>(`/analytics/regen?${params}`, { signal })'));
assert.ok(router.includes('r.Route("/drives"'));
assert.ok(router.includes('r.Get("/analytics/regen", regenHandler.Stats)'));
assert.ok(hook.includes('enabled: !!vehicleId'));
assert.ok(hook.includes("params.set('vehicle_id', vehicleId)"));

// Execute real pure TS modules in memory, without bundling or project TSC.
const modules = new Map();
function load(relative) {
  if (modules.has(relative)) return modules.get(relative).exports;
  const module = { exports: {} };
  modules.set(relative, module);
  const js = ts.transpileModule(read(relative), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const requireLocal = spec => {
    const base = spec.startsWith('@/') ? `web/src/${spec.slice(2)}`
      : path.posix.normalize(path.posix.join(path.posix.dirname(relative), spec));
    const resolved = [`${base}.ts`, `${base}.tsx`, `${base}/index.ts`]
      .find(file => fs.existsSync(path.join(repo, file)));
    assert.ok(resolved, `pure dependency: ${spec}`);
    return load(resolved);
  };
  new Function('require', 'module', 'exports', js)(requireLocal, module, module.exports);
  return module.exports;
}
const { buildRegenEfficiencyModel } = load('web/src/features/driving/lib/regenEfficiency.ts');
const { deriveDataState } = load('web/src/api/dataState.ts');
const { toRegenSectionState, isKnownNumber } = load(`${ownedDir}/presentation.ts`);
const row = { id: 9, startTs: '2026-02-01T01:00:00Z', regenEnergyWh: 0, energyUsedWh: 1000,
  outsideTempAvgC: 0, startBatteryPct: 40, distanceM: 0, durationS: 0, avgSpeedMps: 0 };
const model = buildRegenEfficiencyModel([
  row,
  { ...row, id: 10, regenEnergyWh: 200, energyUsedWh: 2000 },
  { ...row, id: 11, regenEnergyWh: null },
  { ...row, id: 12, regenEnergyWh: NaN },
  { ...row, id: 13, energyUsedWh: 0 },
  { ...row, id: 14, energyUsedWh: Infinity },
  { ...row, id: 15, regenEnergyWh: -1 },
], 7, 'America/Los_Angeles');
assert.equal(model.accounting.observedCount, 7);
assert.equal(model.accounting.eligibleCount, 2);
assert.equal(model.accounting.excludedCount, 5);
assert.equal(model.accounting.historyCapReached, true);
assert.equal(model.energyWeightedRatioPct, 200 / 3000 * 100);
assert.equal(model.months[0].month, '2026-01'); // real timezone boundary
assert.equal(model.ratioDistribution[0].eligibleCount, 1); // measured zero
assert.equal(model.rankedDrives[1].distanceM, 0);
assert.equal(model.temperatureBuckets[1].returnedCount, 7);
assert.equal(model.startingSocBuckets[1].eligibleCount, 2);
const emptyMonth = buildRegenEfficiencyModel([{ ...row, regenEnergyWh: null }], 1000);
assert.equal(emptyMonth.months[0].totalRegenWh, null);
assert.equal(emptyMonth.months[0].energyWeightedRatioPct, null);
assert.equal(emptyMonth.temperatureBuckets[1].energyWeightedRatioPct, null);
const ties = buildRegenEfficiencyModel([{ ...row, id: 4 }, { ...row, id: 2 }], 1000);
assert.deepEqual(ties.rankedDrives.map(item => item.driveId), [4, 2]);
const months = Array.from({ length: 25 }, (_, index) => ({
  ...row, id: index, startTs: new Date(Date.UTC(2024, index, 15)).toISOString(),
}));
const truncated = buildRegenEfficiencyModel(months, 1000);
assert.equal(truncated.displayMonths.length, 24);
assert.equal(truncated.totalMonthCount, 25);
assert.equal(truncated.monthsTruncated, true);
let retries = 0;
const retainedQuery = { data: [row], error: new Error('refresh'), isError: true,
  isSuccess: false, refetch: () => { retries += 1; } };
const retainedState = deriveDataState(retainedQuery, { provenance: 'historical' });
assert.equal(retainedState.data, retainedQuery.data);
assert.equal(retainedState.fatalError, null);
assert.equal(retainedState.status, 'stale');
const section = toRegenSectionState(retainedState, retainedQuery);
assert.equal(section.isResolved, true);
assert.equal(section.error, null);
section.onRetry();
assert.equal(retries, 1);
const disabledQuery = { isLoading: false, isSuccess: false, isPending: true };
assert.equal(toRegenSectionState(deriveDataState(disabledQuery), disabledQuery).isResolved, false);
const failedQuery = { isError: true, error: new Error('initial failure') };
assert.equal(toRegenSectionState(deriveDataState(failedQuery), failedQuery).error, failedQuery.error);
assert.equal(isKnownNumber(null), false);
assert.equal(isKnownNumber(NaN), false);
assert.equal(isKnownNumber(Infinity), false);
assert.equal(isKnownNumber(0), true);

const receipt = {
  scope: 'SOURCE + OFFLINE PURE ONLY; no runtime/browser/typecheck acceptance',
  originalClosure, currentClosure, originalLines, currentLines,
  ratio: currentLines / originalLines, expectedSections,
  preservedTranslationKeys: oldKeys.size, addedTranslationKeys: [...newKeys].filter(key => !oldKeys.has(key)),
  syntaxFiles: syntax, counts,
  sharedSectionFrameReferences: [...all.matchAll(/GlassPanel|ChartContainer|LayoutCard|StatStrip|StatGroup/g)].length,
  ownedHashes: [...production, `${ownedDir}/RegenEfficiencyPresentation.test.tsx`, `${ownedDir}/preservation.check.cjs`]
    .map(file => ({ path: file, sha256: hash(fs.readFileSync(path.join(repo, file))) })),
  routes: ['/drives -> r.Route(\"/drives\") + r.Get(\"/\", driveHandler.ListByVehicle)', '/analytics/regen -> regenHandler.Stats'],
};
fs.writeFileSync(path.join(artifact, 'rawchecks.json'), JSON.stringify(receipt, null, 2));
fs.writeFileSync(path.join(artifact, 'ownedhashes.json'), JSON.stringify(receipt.ownedHashes, null, 2));
const summary = [
  `Offline syntax diagnostics: 0 (${syntax.length} exact owned TS/TSX files; NOT full TSC)`,
  `Original/current reachable feature closure: ${originalLines}/${currentLines} lines (${(receipt.ratio * 100).toFixed(2)}%)`,
  `Persistent sections: ${expectedSections.length}; original translation keys retained: ${oldKeys.size}`,
  `Scoped source counts: ${JSON.stringify(counts)}`,
  `Shared section/frame references: ${receipt.sharedSectionFrameReferences}`,
  'Pure assertions PASS: eligibility/zero/missing/nonfinite, weighted operands, timezone month, stable ties, cap, 24-month truncation, retained refresh, disabled, fatal-only error, retry.',
  'Hooks/router matching PASS: /drives and /analytics/regen. No API/query changes.',
].join('\n');
fs.writeFileSync(path.join(artifact, 'rawchecks.txt'), `${summary}\n`);
console.log(summary);
