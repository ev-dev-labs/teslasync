/* Scoped Node guard, deliberately NOT a Vitest .test file. No app build/typecheck. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const Module = require('node:module');
const repo = path.resolve(__dirname, '../../../../../..');
const ts = require(path.join(repo, 'web/node_modules/typescript'));
const artifact = 'C:/Users/AtulM/.copilot/session-state/bba4960d-f516-4831-bda3-877640f907ce/files/parallel-battery-care-page-live';
const original = path.join(artifact, 'original');
const pagePath = 'web/src/features/battery/pages/BatteryCarePage.tsx';
const owned = 'web/src/features/battery/components/battery-care-modernization';
const read = p => fs.readFileSync(path.join(repo, p), 'utf8');
const hash = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const files = fs.readdirSync(path.join(repo, owned))
  .filter(file => /\.(ts|tsx|cjs)$/.test(file)).map(file => `${owned}/${file}`);
const production = [pagePath, ...files.filter(file => !/\.test\.|\.check\./.test(file))];
const walk = (node, fn) => { fn(node); ts.forEachChild(node, child => walk(child, fn)); };
const queryCalls = text => {
  const calls = [];
  walk(ts.createSourceFile('page.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX), node => {
    if (ts.isCallExpression(node) && ['useChargingHistory', 'useDriveHistory', 'computeBatteryCare'].includes(node.expression.getText())) {
      calls.push(node.getText().replace(/\s+/g, ''));
    }
  });
  return calls;
};
assert.deepEqual(queryCalls(read(pagePath)), queryCalls(fs.readFileSync(path.join(original, pagePath), 'utf8')));
console.log('PASS: query calls and model operands identical to ORIGINAL CURRENT DIRTY page');

let privateCount = 0;
for (const base of ['web/src/features/battery/components/battery-care', 'web/src/features/battery/lib']) {
  for (const file of fs.readdirSync(path.join(original, base))) {
    const p = path.join(base, file);
    assert.equal(hash(path.join(repo, p)), hash(path.join(original, p)), `Readonly private file changed: ${p}`);
    privateCount++;
  }
}
for (const p of ['web/src/api/hooks/useCharging.ts', 'web/src/api/hooks/useDriving.ts']) {
  assert.equal(hash(path.join(repo, p)), hash(path.join(original, p)), `Hook changed: ${p}`);
}
console.log(`PASS: ${privateCount} original private/model files and both history hooks byte-preserved`);
const router = read('internal/api/router.go');
assert.match(router, /r\.Route\("\/charging",[\s\S]*?r\.Get\("\/", chargingHandler\.ListByVehicle\)/);
assert.match(router, /r\.Route\("\/drives",[\s\S]*?r\.Get\("\/", driveHandler\.ListByVehicle\)/);
console.log('PASS: /charging and /drives hook URLs match existing router groups');

const audit = { inlineStyles: 0, rawControls: 0, directLibraryImports: 0, camelCaseQuery: 0, zeroFallbacks: 0 };
for (const file of production) {
  const source = read(file);
  audit.inlineStyles += (source.match(/style=\{\{/g) ?? []).length;
  audit.rawControls += (source.match(/<(button|input|textarea|select|table)\b/g) ?? []).length;
  audit.directLibraryImports += (source.match(/from ['"](recharts|react-leaflet|framer-motion)['"]/g) ?? []).length;
  audit.camelCaseQuery += (source.match(/vehicleId=/g) ?? []).length;
  audit.zeroFallbacks += (source.match(/\?\?\s*0\b/g) ?? []).length;
  const result = ts.transpileModule(source, {
    fileName: file, reportDiagnostics: true,
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  });
  assert.equal((result.diagnostics ?? []).filter(d => d.category === ts.DiagnosticCategory.Error).length, 0, `Syntax: ${file}`);
}
assert.deepEqual(audit, { inlineStyles: 0, rawControls: 0, directLibraryImports: 0, camelCaseQuery: 0, zeroFallbacks: 0 });
console.log(`PASS: production syntax-only transpilation (NOT full typecheck); audits ${JSON.stringify(audit)}`);
const keys = text => {
  const found = new Set();
  walk(ts.createSourceFile('component.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX), node => {
    if (ts.isCallExpression(node) && node.expression.getText() === 't'
      && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) found.add(node.arguments[0].text);
  });
  return found;
};
const privateDir = 'web/src/features/battery/components/battery-care';
const originalTexts = [fs.readFileSync(path.join(original, pagePath), 'utf8'),
  ...fs.readdirSync(path.join(original, privateDir)).filter(f => f.endsWith('.tsx'))
    .map(f => fs.readFileSync(path.join(original, privateDir, f), 'utf8'))];
const reusedTexts = ['RankedCareHabits.tsx', 'BatteryCareMethodology.tsx', 'BatteryCareSection.tsx']
  .map(f => read(`${privateDir}/${f}`));
const originalKeys = keys(originalTexts.join('\n'));
const currentKeys = keys([...production.map(read), ...reusedTexts].join('\n'));
const missingKeys = [...originalKeys].filter(key => !currentKeys.has(key));
assert.deepEqual(missingKeys, [], 'Original section/metric/explanation labels lost');
console.log(`PASS: all ${originalKeys.size} original literal i18n keys retained in active production closure`);
const mountedFile = files.find(file => file.endsWith('.mounted.test.tsx'));
const mountedSyntax = ts.transpileModule(read(mountedFile), { fileName: mountedFile, reportDiagnostics: true,
  compilerOptions: { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } });
assert.equal((mountedSyntax.diagnostics ?? []).filter(d => d.category === ts.DiagnosticCategory.Error).length, 0);
console.log('PASS: authored mounted-test syntax-only transpilation; mounted execution NOTRUN');

// Load ONLY two pure modules and the new pure projection, with no React/Vite graph.
function loadPure(relative, replacements = {}) {
  const filename = path.join(repo, relative);
  const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const mod = new Module(filename);
  mod.filename = filename;
  mod.require = id => {
    assert.ok(Object.hasOwn(replacements, id), `Unexpected pure-module dependency: ${id}`);
    return replacements[id];
  };
  mod._compile(compiled, filename);
  return mod.exports;
}
const data = loadPure('web/src/api/dataState.ts');
const projection = loadPure(`${owned}/state.ts`, { '@/api/dataState': data });
const model = loadPure('web/src/features/battery/lib/batteryCare.ts');
const now = Date.UTC(2026, 9, 4, 12);
const stamp = new Date(now).toISOString();
const sessions = Array.from({ length: 5 }, (_, i) => ({
  id: String(i), charger_type: 'AC', end_soc_pct: 95,
  total_energy_added_wh: 10000, peak_power_w: 7000, started_at: stamp,
}));
const drives = Array.from({ length: 5 }, (_, i) => ({ id: i, endBatteryPct: 5, startTs: stamp }));
const before = JSON.stringify({ sessions, drives });
const care = model.computeBatteryCare(sessions, drives, { nowMs: now, sessionLimit: 1000, driveLimit: 1000 });
assert.equal(JSON.stringify({ sessions, drives }), before);
assert.equal(care.scoreReady, true);
assert.equal(care.fullChargeShare, 1);
assert.equal(care.deepDischargeShare, 1);
assert.equal(care.dcEnergyShare, 0);
assert.equal(care.energyMix.totalEnergyWh, 50000);
assert.equal(care.monthly.length, 6);
assert.equal(model.computeBatteryCare([], [], { nowMs: now }).score, null);
assert.equal(model.computeBatteryCare(sessions, [], { nowMs: now }).score, null);
let retriesA = 0;
let retriesB = 0;
const healthy = data.deriveDataState({ data: sessions, refetch: () => { retriesA++; } }, { provenance: 'historical' });
const fatal = data.deriveDataState({ error: new Error('initial'), refetch: () => { retriesB++; } });
const mixed = projection.careSectionState([{ label: 'charging', state: healthy }, { label: 'driving', state: fatal }]);
assert.equal(mixed.trust.hasData, true);
assert.equal(mixed.trust.status, 'partial');
assert.equal(mixed.trust.fatalError, null);
assert.equal(projection.specialistState(mixed).isLoading, false);
mixed.trust.retry();
assert.deepEqual([retriesA, retriesB], [0, 1]);
const refresh = data.deriveDataState({ data: sessions, error: new Error('refresh'), fetchStatus: 'paused' });
assert.equal(refresh.data, sessions);
assert.equal(refresh.fatalError, null);
assert.equal(refresh.status, 'stale');
assert.equal(refresh.isRefreshBlocked, true);
const pending = data.deriveDataState({ fetchStatus: 'paused' });
assert.equal(pending.hasData, false);
assert.equal(pending.status, 'initial');
assert.equal(pending.isRefreshBlocked, true);
const empty = data.deriveDataState({ data: [] });
assert.equal(empty.hasData, true);
assert.equal(empty.status, 'ok');
const failedBoth = projection.careSectionState([{ label: 'a', state: fatal }, { label: 'b', state: fatal }]);
assert.equal(projection.specialistState(failedBoth).error, fatal.fatalError);
console.log('PASS: pure model raw-SI/no-mutation/calibration/null/monthly checks and independent trust/retry/paused/empty checks');

const compositeSource = production.map(read).join('\n');
assert.match(compositeSource, /chartKey="battery-care-monthly"/);
for (const series of ['sessions', 'drives', 'score']) assert.match(compositeSource, new RegExp(`dataKey="${series}"`));
assert.match(compositeSource, /connectNulls=\{false\}/);
assert.match(compositeSource, /mobilePresentation=\{mobilePresentation\}/);
assert.match(compositeSource, /roles: \{ month: 'title', score: 'primary', sessions: 'meta', drives: 'meta' \}/);
assert.match(read('web/src/components/ui/MobileDataTableAdapter.tsx'), /allColumns\.filter/);
assert.match(read('web/src/components/ui/MobileDataTableAdapter.tsx'), /column\.render\(detailRow\)/);
console.log('PASS: real chart key/three series/null gaps and mobile four-column/all-details source guards');
const lines = text => text.trimEnd().split(/\r?\n/).length;
const originalPageLines = lines(fs.readFileSync(path.join(original, pagePath), 'utf8'));
const currentPageLines = lines(read(pagePath));
const productionLines = production.reduce((sum, p) => sum + lines(read(p)), 0);
assert.ok(productionLines >= originalPageLines * 0.7);
console.log(JSON.stringify({ originalPageLines, currentPageLines, productionPageAndNewClosureLines: productionLines,
  sectionCount: 8, originalSeriesCount: 3, currentSeriesCount: 3, syntaxFiles: production.length }, null, 2));
console.log('OWNED_CURRENT_SHA256');
for (const p of [pagePath, ...files]) console.log(`${hash(path.join(repo, p))}  ${p}`);
console.log('NOTRUN: full TypeScript/build/full Vitest/Go/browser/runtime/mobile visual/whole-app acceptance');
