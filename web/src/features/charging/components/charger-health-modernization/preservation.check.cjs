/* Scoped Node/source/pure check. No runtime, browser, build or app acceptance. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const Module = require('node:module');
const root = path.resolve(__dirname, '../../../../../..');
const ts = require(path.join(root, 'web/node_modules/typescript'));
const artifacts = 'C:\\Users\\AtulM\\.copilot\\session-state\\bba4960d-f516-4831-bda3-877640f907ce\\files\\parallel-charger-health-page-live';
const frozen = path.join(artifacts, 'frozen');
const page = 'web/src/features/charging/pages/ChargerHealthPage.tsx';
const specialist = 'web/src/features/charging/lib/chargerHealth.ts';
const hook = 'web/src/api/hooks/useCharging.ts';
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const digest = buffer => crypto.createHash('sha256').update(buffer).digest('hex');
const production = [page, ...fs.readdirSync(__dirname)
  .filter(name => /\.tsx?$/.test(name) && !name.includes('.test.'))
  .map(name => path.relative(root, path.join(__dirname, name)))];
let assertions = 0;
function check(condition, message) { assert.ok(condition, message); assertions++; }
for (const file of [specialist, hook, 'web/src/types/charging.ts']) {
  check(fs.readFileSync(path.join(root, file)).equals(fs.readFileSync(path.join(frozen, file))),
    `Read-only critical input drift: ${file}`);
}
check(digest(fs.readFileSync(path.join(frozen, page))) ===
  '1b79234e5017d94775ec38f2d3e70cea8e99e9c90eeed43e3f69a4687804cdaa', 'Original dirty freeze changed');
const sources = production.map(read);
const closure = sources.join('\n');
const original = fs.readFileSync(path.join(frozen, page), 'utf8');
const originalLines = original.split(/\r?\n/).length;
const productionLines = sources.reduce((sum, text) => sum + text.split(/\r?\n/).length, 0);
check(productionLines >= originalLines * 0.7, 'Production closure below 70% preservation floor');
const test = path.join(__dirname, 'ChargerHealthPage.runtime.test.tsx');
for (const filename of [...production.map(file => path.join(root, file)), test]) {
  const ast = ts.createSourceFile(filename, fs.readFileSync(filename, 'utf8'), ts.ScriptTarget.Latest, true,
    filename.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  check(ast.parseDiagnostics.length === 0, `Syntax diagnostics: ${filename}`);
}
for (const call of ['useChargingSessions(vehicleIdStr)', 'analyzeChargerHealth(sessionsQuery.data ?? [])']) {
  check(original.includes(call) && closure.includes(call), `Original operand missing: ${call}`);
}
for (const key of ['sites', 'sessionsHint', 'degraded', 'degradedHint', 'fastest', 'none',
  'timeLost', 'timeLostHint', 'chart', 'chartHint', 'noData', 'detail', 'noSites',
  'baselinePower', 'recentPower', 'energy', 'visits', 'visitsValue', 'lastSeen', 'cost', 'costValue']) {
  check(closure.includes(`chargerHealth.${key}`), `Original fact absent: ${key}`);
}
for (const token of ['height={340}', 'domain={[0, 110]}', 'angle={-30}', 'height={64}',
  'dataKey="ratio"', 'radius={[3, 3, 0, 0]}', 'strokeOpacity={0.4}',
  '<ChartTooltip', '<ReferenceLine y={100}', 'chartTokens.series[2]',
  'chartTokens.series[3]', 'chartTokens.series[5]']) {
  check(closure.includes(token), `Original chart behavior absent: ${token}`);
}
check(closure.includes("site.status !== 'unknown'"), 'Chart eligibility changed');
check(closure.includes('Math.round(site.performanceRatio * 1000) / 10'), 'Ratio rounding changed');
check(closure.includes('Math.round(site.baselineW / 100) / 10'), 'Fallback baseline rounding changed');
check(closure.includes('Math.round(site.recentW / 100) / 10'), 'Fallback recent rounding changed');
check(closure.includes('useDataState(sessionsQuery'), 'Independent source trust missing');
check(closure.includes('mobilePresentation={{') && closure.includes('tableId="charging:charger-health-locations"'),
  'Shared persistent mobile table adoption missing');
check(!/\b(?:fetch|request|useHiddenSeries)\s*\(/.test(closure), 'New data or legend controller');
const chartSource = read(path.relative(root, path.join(__dirname, 'ChargerHealthChart.tsx')));
check(!/\b(?:annotations|fullscreen|exportData|exportable|chartKey)=/.test(chartSource), 'Original omitted chart opt-ins changed');
const violations = {
  inlineStyles: (closure.match(/style=\{\{/g) ?? []).length,
  rawControls: (closure.match(/<(?:button|input|textarea|select|table)\b/g) ?? []).length,
  directLibraries: (closure.match(/from ['"](?:recharts|react-leaflet|framer-motion)['"]/g) ?? []).length,
  camelQueryParam: (closure.match(/vehicleId=/g) ?? []).length,
};
for (const [key, count] of Object.entries(violations)) check(count === 0, `${key}: ${count}`);
const testSource = fs.readFileSync(test, 'utf8');
check(testSource.includes("importOriginal<typeof import('@/components/motion')>()") && testSource.includes('...actual,'),
  'Typed partial motion mock absent');
check(testSource.includes('beforeEach(() => {') && testSource.includes('vi.clearAllMocks();'), 'Void mock reset missing');
check(testSource.includes('return render(<ChargerHealthPage />, { wrapper: Harness })')
  && testSource.includes('result.rerender(<ChargerHealthPage />)'), 'Persistent real Router harness absent');
const router = read('internal/api/router.go');
const handler = read('internal/handler/v1/charging_handler.go');
check(router.includes('v1ChargingHandler.Register(r)') && handler.includes('r.Get("/charging-sessions", h.List)'),
  'Matching registered route missing');
const hookSource = read(hook);
check(hookSource.includes('`/charging-sessions?vehicle_id=${vehicleId}`'), 'Original hook wire URL missing');

// Parent owns the English catalog. Validate the handoff only; never write en.json.
const english = JSON.parse(read('web/src/i18n/en.json'));
const additive = Object.fromEntries(Object.entries(
  JSON.parse(fs.readFileSync(path.join(artifacts, 'english.additive.json'), 'utf8')),
).map(([key, value]) => [key === 'chargerHealth.chart.aria' ? 'chargerHealth.chartAria' : key, value]));
const catalogValue = key => key.split('.').reduce((value, part) => value?.[part], english) ?? english[key];
const expectedEnglish = {};
for (const file of production) {
  const ast = ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true);
  function visit(node) {
    if (ts.isCallExpression(node) && node.expression.getText(ast) === 't'
      && node.arguments.length >= 2 && ts.isStringLiteral(node.arguments[0]) && ts.isStringLiteral(node.arguments[1])) {
      const key = node.arguments[0].text;
      if (Object.hasOwn(additive, key) || catalogValue(key) == null) {
        expectedEnglish[key] = node.arguments[1].text;
      }
    }
    if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(ast) === 'HelpTooltip') {
      const attributes = Object.fromEntries(node.attributes.properties
        .filter(attribute => ts.isJsxAttribute(attribute) && attribute.initializer && ts.isStringLiteral(attribute.initializer))
        .map(attribute => [attribute.name.getText(ast), attribute.initializer.text]));
      if (attributes.i18nKey && (Object.hasOwn(additive, attributes.i18nKey) || catalogValue(attributes.i18nKey) == null)) {
        expectedEnglish[attributes.i18nKey] = attributes.defaultValue;
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
}
for (const [status, label] of Object.entries({ healthy: 'Healthy', degrading: 'Slipping', degraded: 'Degraded', unknown: 'Not enough data' })) {
  const key = `chargerHealth.status.${status}`;
  if (Object.hasOwn(additive, key) || catalogValue(key) == null) expectedEnglish[key] = label;
}
assert.deepEqual(additive, expectedEnglish); assertions++;
for (const [key, value] of Object.entries(additive)) {
  const current = catalogValue(key);
  check(current == null || current === value, `English handoff conflicts with existing key: ${key}`);
}

// Execute only the existing pure, React-free specialist. No network/hook mounting.
const filename = path.join(root, specialist);
const output = ts.transpileModule(read(specialist), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const moduleInstance = new Module(filename);
moduleInstance.filename = filename;
moduleInstance.paths = Module._nodeModulePaths(path.dirname(filename));
moduleInstance._compile(output, filename);
const { analyzeChargerHealth, toSessionMetric, siteKeyOf } = moduleInstance.exports;
function session(index, powerW, overrides = {}) {
  const start = new Date(Date.UTC(2026, 8, index + 1)).toISOString();
  return { id: String(index), start_place: 'Home', started_at: start, start_ts: start,
    duration_min: 60, total_energy_added_wh: powerW, start_soc_pct: 20, end_soc_pct: 60, ...overrides };
}
const history = recentW => Array.from({ length: 10 }, (_, index) => session(index, index < 5 ? 10000 : recentW));
const input = history(7000);
const serialized = JSON.stringify(input);
const summary = analyzeChargerHealth(input);
assert.equal(JSON.stringify(input), serialized); assertions++;
assert.equal(summary.sites[0].status, 'degraded'); assertions++;
assert.equal(summary.sites[0].baselineW, 10000); assertions++;
assert.equal(summary.sites[0].recentW, 7000); assertions++;
assert.equal(summary.sites[0].performanceRatio, 0.7); assertions++;
assert.equal(summary.sites[0].totalEnergyWh, 85000); assertions++;
assert.equal(summary.sites[0].hoursLostPerYear, 147.7); assertions++;
assert.equal(summary.sites[0].history.length, 10); assertions++;
assert.equal(summary.sites[0].history[0].durationS, 3600); assertions++;
assert.equal(analyzeChargerHealth(history(7500)).sites[0].status, 'degrading'); assertions++;
assert.equal(analyzeChargerHealth(history(9000)).sites[0].status, 'healthy'); assertions++;
assert.equal(analyzeChargerHealth([session(0, 10000)]).sites[0].status, 'unknown'); assertions++;
assert.equal(analyzeChargerHealth([session(0, 10000)]).sites[0].baselineW, 0); assertions++;
assert.equal(analyzeChargerHealth([]).fastestSite, null); assertions++;
assert.equal(toSessionMetric(session(0, 1999), 80, 600, 2000), null); assertions++;
assert.equal(toSessionMetric(session(0, 2000, { duration_min: 9 }), 80, 600, 2000), null); assertions++;
assert.equal(toSessionMetric(session(0, 2000, { duration_min: 10 }), 80, 600, 2000).durationS, 600); assertions++;
assert.equal(toSessionMetric(session(0, 10000, { start_soc_pct: 80, end_soc_pct: 100 }), 80, 600, 2000).tapered, true); assertions++;
assert.equal(siteKeyOf(session(0, 10000, { start_place: '', start_lat: null, start_lng: null })), null); assertions++;
assert.equal(siteKeyOf(session(0, 10000, { start_place: ' HOME ' })).key, 'place:home'); assertions++;
assert.equal(analyzeChargerHealth(history(30000)).sites[0].kind, 'dc'); assertions++;
const sectionCounts = {
  originalGlassPanelOrChartContainer: (original.match(/GlassPanel|ChartContainer/g) ?? []).length,
  currentPageGlassPanelOrChartContainer: (read(page).match(/GlassPanel|ChartContainer/g) ?? []).length,
  closureGlassPanelOrChartContainer: (closure.match(/GlassPanel|ChartContainer/g) ?? []).length,
  semanticSections: ['ChargerHealthStats', 'ChargerHealthChart', 'ChargerHealthLocations'],
};
const hashes = [...production, path.relative(root, test), path.relative(root, __filename)].map(file => ({
  path: file.replaceAll('\\', '/'), sha256: digest(fs.readFileSync(path.join(root, file))),
}));
console.log(JSON.stringify({ status: 'SCOPED_SOURCE_PURE_PASS', assertions,
  originalLines, productionLines, ratio: productionLines / originalLines,
  violations, sectionCounts, hookRoute: '/charging-sessions?vehicle_id=…',
  englishAdditiveKeys: Object.keys(additive).length,
  englishSha256: digest(fs.readFileSync(path.join(artifacts, 'english.additive.json'))),
  runtime: 'AUTHORED_NOTRUN', hashes }, null, 2));
