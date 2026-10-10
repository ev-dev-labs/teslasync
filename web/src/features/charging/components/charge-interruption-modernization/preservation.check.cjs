/* Small source/pure guard only. No app mount, build, catalog or browser work.
 * Usage: node <this file> <absolute acquisition artifact directory> */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');
const ts = require('typescript');

const repo = path.resolve(__dirname, '../../../../../..');
const artifacts = process.argv[2];
assert.ok(artifacts && path.isAbsolute(artifacts), 'Pass the immutable acquisition directory');
const pagePath = 'web/src/features/charging/pages/ChargeInterruptionPage.tsx';
const read = relative => fs.readFileSync(path.join(repo, relative), 'utf8');
const original = fs.readFileSync(path.join(artifacts, 'original', pagePath), 'utf8');
const page = read(pagePath);
const stats = fs.readFileSync(path.join(__dirname, 'ChargeInterruptionStats.tsx'), 'utf8');
const receipt = JSON.parse(fs.readFileSync(path.join(artifacts, 'original-hashes.json'), 'utf8'));
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex').toUpperCase();
let checks = 0;
function check(name, fn) { fn(); checks++; console.log(`PASS ${name}`); }
function block(source, start, end) {
  const from = source.indexOf(start);
  assert.ok(from >= 0, `Missing ${start}`);
  const to = source.indexOf(end, from);
  assert.ok(to > from, `Missing ${end}`);
  return source.slice(from, to + end.length).replace(/\s+/g, ' ');
}
check('CURRENTDIRTY snapshots match acquisition SHA256; domain source and original tests untouched', () => {
  for (const item of receipt) {
    assert.equal(item.source, 'CURRENTDIRTY');
    const snapshot = fs.readFileSync(path.join(artifacts, 'original', item.path));
    assert.equal(sha(snapshot), item.sha256);
    if (!item.path.endsWith('ChargeInterruptionPage.tsx')) {
      assert.equal(sha(fs.readFileSync(path.join(repo, item.path))), item.sha256);
    }
  }
});
check('original cause and trend distinctions, labels and badge meanings preserved', () => {
  for (const [start, end] of [
    ['const CAUSE_DEFAULTS', '};'], ['const TREND_BADGE', '};'],
    ['const TREND_DEFAULTS', '};'],
  ]) assert.equal(block(page, start, end), block(original, start, end));
});
check('chart model mapping, all series, axes, palette, tooltip and stable legend key unchanged', () => {
  assert.equal(block(page, 'const chartData = useMemo(', '[summary.sites],\n  );'),
    block(original, 'const chartData = useMemo(', '[summary.sites],\n  );'));
  assert.equal(block(page, '<ComposedChart', '</ComposedChart>'),
    block(original, '<ComposedChart', '</ComposedChart>'));
  assert.ok(page.includes("const CHART_KEY = 'charge-interruption-risk-by-site'"));
  assert.equal(block(page, 'dataColumns={[', ']}'), block(original, 'dataColumns={[', ']}'));
  for (const capability of ['exportData=', 'fullscreen=', 'annotations=', '<Brush']) {
    assert.equal(page.includes(capability), original.includes(capability));
  }
});
check('every original literal translation key remains in page or extracted metrics', () => {
  const keys = [...original.matchAll(/['"]((?:chargeInterruption|help\.chargeInterruption)\.[A-Za-z.]+)['"]/g)]
    .map(match => match[1]);
  for (const key of keys) assert.ok(`${page}\n${stats}`.includes(key), `Lost key ${key}`);
});
check('six complete metrics retain posterior calculations, conservative site selection and counts', () => {
  assert.equal((stats.match(/occurrenceId:/g) ?? []).length, 6);
  for (const expression of [
    'summary.overallPosteriorMean * 100', 'summary?.suspectedSessions',
    'summary.highestRiskSite.posteriorMean * 100', 'summary?.sites.length',
    'summary?.totalSessions', 'summary?.evaluableSessions',
    'summary.overallPosteriorMean > 0.3', 'summary.overallPosteriorMean > 0.15',
  ]) assert.ok(stats.includes(expression), `Missing ${expression}`);
  assert.ok(stats.includes('units: { locale }'));
  assert.ok(stats.includes("const riskDisplay = { precision,"));
  assert.ok(stats.includes("kind: 'unknown'"));
  assert.ok(stats.includes('up to 1,000 returned sessions'));
  assert.ok(stats.includes('this is the model prior'));
  assert.ok(!stats.includes('new Date'));
});
check('existing query call scope preserved and router supports the exact existing history endpoint', () => {
  assert.ok(page.includes('useChargingHistory(vehicleIdStr)'));
  assert.ok(page.includes('analyzeChargeInterruptions(sessionsQuery.data ?? [])'));
  assert.ok(!page.includes('useRangeState'));
  assert.ok(!page.includes('RangePicker'));
  const hook = read('web/src/api/hooks/useCharging.ts');
  assert.ok(hook.includes('chargingKeys.history(vehicleId'));
  assert.ok(hook.includes('/charging?vehicle_id='));
  assert.ok(hook.includes('{ signal }'));
  const router = read('internal/api/router.go');
  assert.ok(router.includes('r.Route("/charging"'));
  assert.ok(router.includes('r.Get("/", chargingHandler.ListByVehicle)'));
});
check('fatal-only errors and retained warnings never gate the entire page; no truncation of site list', () => {
  assert.ok(page.includes('deriveDataState(sessionsQuery'));
  assert.ok(page.includes('const fatalError = sessionsState.fatalError'));
  assert.ok(page.includes('<StaleRefreshWarning state={sessionsState}'));
  assert.ok(page.includes('error={fatalError}'));
  assert.ok(page.includes('summary.sites.map((s)'));
  assert.ok(!page.includes('summary.sites.slice'));
  assert.ok(page.includes("s.lastSuspectedMs != null ? <TimeStamp"));
  assert.ok(page.includes('@3xl:grid-cols-2 @6xl:grid-cols-3'));
  assert.ok(page.includes('<PageLayout'));
  assert.ok(stats.includes('<StatStrip'));
});
check('owned TSX syntax and prohibited-pattern checks', () => {
  for (const [name, source] of [['page.tsx', page], ['stats.tsx', stats],
    ['runtime.test.tsx', fs.readFileSync(path.join(__dirname, 'ChargeInterruptionPage.runtime.test.tsx'), 'utf8')]]) {
    const parsed = ts.createSourceFile(name, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    assert.equal(parsed.parseDiagnostics.length, 0, `${name} parse diagnostics`);
    assert.ok(!/style=\{\{|<(?:button|input|textarea|select|table)\b|from ['"](?:recharts|react-leaflet|framer-motion)['"]/.test(source));
  }
});
check('production page plus extraction retains >=70% of CURRENTDIRTY page lines', () => {
  const lines = source => source.trimEnd().split(/\r?\n/).length;
  const currentLines = lines(page) + lines(stats) + 1;
  assert.ok(currentLines >= lines(original) * 0.7);
  console.log(`LINES original=${lines(original)} currentPage=${lines(page)} extraction=${lines(stats) + 1} closure=${currentLines}`);
});
function loadPure(relative) {
  const source = read(relative);
  const code = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const sandbox = { exports: {}, Date, Error, console };
  vm.runInNewContext(code, sandbox, { filename: relative });
  return sandbox.exports;
}
check('pure Bayesian prior and credible-interval properties preserved', () => {
  const model = loadPure('web/src/features/charging/lib/chargeInterruption.ts');
  const empty = model.analyzeChargeInterruptions([]);
  assert.equal(empty.totalSessions, 0);
  assert.equal(empty.evaluableSessions, 0);
  assert.equal(empty.overallPosteriorMean, 0.5);
  assert.equal(empty.highestRiskSite, null);
  const sparse = model.betaPosterior(1, 2);
  const rich = model.betaPosterior(50, 100);
  assert.ok(Math.abs(sparse.mean - rich.mean) < 1e-8);
  assert.ok(rich.high - rich.low < sparse.high - sparse.low);
});
check('pure retained/fatal/offline trust semantics keep payload identity and source retry', () => {
  const { deriveDataState } = loadPure('web/src/api/dataState.ts');
  const data = [];
  const error = new Error('private source detail');
  let retries = 0;
  const retained = deriveDataState({ data, error, isError: true, refetch: () => { retries++; } });
  assert.equal(retained.data, data);
  assert.equal(retained.fatalError, null);
  assert.equal(retained.refreshError, error);
  retained.retry();
  assert.equal(retries, 1);
  const initial = deriveDataState({ error, isError: true });
  assert.equal(initial.fatalError, error);
  assert.equal(initial.hasData, false);
  const paused = deriveDataState({ fetchStatus: 'paused' });
  assert.equal(paused.isRefreshBlocked, true);
  assert.equal(paused.hasData, false);
});
console.log(`PASS ${checks} scoped source/pure checks; runtime/app acceptance NOTRUN`);
