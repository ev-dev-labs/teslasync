/* Bounded, offline Node tests: no application boot, API calls or vehicle commands.
 * SOFTWARE_UPDATES_ORIGINAL points to the immutable pre-edit page acquisition.
 * Run with node --test; this is intentionally not a normal Vitest invocation.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const pagePath = path.resolve(__dirname, '../../pages/SoftwareUpdatesPage.tsx');
const current = fs.readFileSync(pagePath, 'utf8');
const baselinePath = process.env.SOFTWARE_UPDATES_ORIGINAL;
const original = baselinePath ? fs.readFileSync(baselinePath, 'utf8') : null;
const printer = ts.createPrinter({ removeComments: true });
const parse = text => ts.createSourceFile('page.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const print = (node, file) => printer.printNode(ts.EmitHint.Unspecified, node, file);
function find(text, name) {
  const file = parse(text);
  let found;
  function visit(node) {
    if ((ts.isVariableDeclaration(node) || ts.isFunctionDeclaration(node) || ts.isInterfaceDeclaration(node))
      && node.name?.getText(file) === name) found = print(node, file);
    ts.forEachChild(node, visit);
  }
  visit(file);
  assert.ok(found, `Missing preserved closure ${name}`);
  return found;
}
const closures = ['SoftwareUpdate', 'PAGE_SIZE', 'monthLabel', 'updatesQuery', 'updates',
  'vehicleMap', 'installedUpdates', 'latestVersion', 'installedCount', 'totalUpdates',
  'pendingCount', 'lastInstalledAt', 'cadence', 'statusCounts',
  'paginationTotal', 'previousRange', 'handleRetry'];

test('private presenter: syntax and unknown/zero/retained/error transitions', () => {
  const text = fs.readFileSync(path.join(__dirname, 'presenter.ts'), 'utf8');
  const result = ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.CommonJS }, reportDiagnostics: true });
  assert.deepEqual(result.diagnostics, []);
  const sandbox = { exports: {} };
  vm.runInNewContext(result.outputText, sandbox);
  const { softwareSourceState: state, observedCount } = sandbox.exports;
  const plain = value => JSON.parse(JSON.stringify(value));
  for (const data of [undefined, null, {}, 'invalid']) {
    assert.deepEqual(plain(state(data, false, false)), {
      available: false, initialLoading: false, fatalError: false, retained: false, empty: false,
    });
    assert.equal(state(data, true, false).initialLoading, true);
    assert.equal(state(data, false, true).fatalError, true);
  }
  assert.equal(state([], false, false).empty, true);
  assert.equal(state([], false, true).retained, true);
  assert.equal(state([{ id: 1 }], true, false).initialLoading, false);
  assert.equal(state([{ id: 1 }], false, true).fatalError, false);
  assert.equal(observedCount(false, 0), null);
  assert.equal(observedCount(true, 0), 0);
  assert.equal(observedCount(true, 50), 50);
});

test('all owned TypeScript sources parse without syntax diagnostics', () => {
  for (const filename of [pagePath, ...['presenter.ts', 'SoftwareCadenceCard.tsx', 'SoftwareHistoryItem.tsx', 'SoftwareUpdatesPage.test.tsx'].map(name => path.join(__dirname, name))]) {
    const file = parse(fs.readFileSync(filename, 'utf8'));
    assert.deepEqual(file.parseDiagnostics, [], filename);
    const result = ts.transpileModule(file.text, {
      fileName: filename,
      compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
      reportDiagnostics: true,
    });
    assert.deepEqual(result.diagnostics, [], filename);
  }
});

test('immutable original query, wire shape, derived operands and callbacks remain exact',
  { skip: !original && 'Set SOFTWARE_UPDATES_ORIGINAL for original-current closure proof' }, () => {
    for (const name of closures) assert.equal(find(current, name), find(original, name), name);
    assert.ok(find(current, 'avgCadence').includes('/ 1000 / (ms.length - 1)'));
    assert.ok(current.includes("days: fmtInt(raw / 86400)"));
    const rangeEffect = text => {
      const file = parse(text);
      let effect;
      function visit(node) {
        if (ts.isCallExpression(node) && node.expression.getText(file) === 'useEffect') effect = print(node, file);
        ts.forEachChild(node, visit);
      }
      visit(file);
      return effect;
    };
    assert.equal(rangeEffect(current), rangeEffect(original));
    const range = text => text.match(/useRangeState\(\{[\s\S]*?\}\)/)[0];
    assert.equal(range(current), range(original));
  });

function derive(text, data) {
  const names = ['updates', 'installedUpdates', 'latestVersion', 'installedCount', 'totalUpdates',
    'pendingCount', 'lastInstalledAt', 'avgCadence', 'cadence', 'statusCounts', 'paginationTotal'];
  const code = `${find(text, 'monthLabel')}\n${names.map(name => `const ${find(text, name)};`).join('\n')}
    result = { updates, latestVersion, installedCount, totalUpdates, pendingCount, lastInstalledAt, avgCadence, cadence, statusCounts, paginationTotal };`;
  const compiled = ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const sandbox = {
    data, page: 2, PAGE_SIZE: 50, useMemo: fn => fn(), fmtInt: n => Math.round(n).toString(),
    t: (_key, fallback, values) => fallback.replace('{{days}}', values.days),
  };
  vm.runInNewContext(compiled, sandbox);
  if (text === current) {
    const raw = sandbox.result.avgCadence;
    sandbox.result.avgCadence = raw == null ? '—' : `${Math.round(raw / 86400)}d`;
  }
  return JSON.parse(JSON.stringify(sandbox.result));
}
test('fake-only derivation parity: missing, empty, invalid dates, duplicates, future statuses, page boundary',
  { skip: !original && 'Set SOFTWARE_UPDATES_ORIGINAL for derivation parity' }, () => {
    const row = (id, status, installed_at, created_at = '2026-01-01T12:00:00Z') => ({
      id, vehicle_id: 1, version: `2026.${id}`, status, installed_at,
      scheduled_at: '2026-12-01T12:00:00Z', created_at,
    });
    const cases = [undefined, null, {}, [], [row(1, 'future', null)],
      [row(1, 'installed', 'invalid', 'invalid')],
      [row(1, 'installed', '2026-01-01'), row(2, 'installed', '2026-01-01'), row(3, 'failed', null)],
      [row(1, 'installed', '2026-01-01'), row(2, 'installed', '2026-01-11'), row(3, 'scheduled', null)],
      Array.from({ length: 50 }, (_, index) => row(index, 'installed', '2026-02-01'))];
    for (const data of cases) assert.deepEqual(derive(current, data), derive(original, data));
    assert.equal(derive(current, []).totalUpdates, 0);
    assert.equal(derive(current, [row(1, 'future', null)]).pendingCount, 1);
    assert.equal(derive(current, Array.from({ length: 50 }, (_, index) => row(index, 'installed', null))).paginationTotal, 101);
  });

test('all original domain translations, links and action bindings stay reachable',
  { skip: !original && 'Set SOFTWARE_UPDATES_ORIGINAL for preservation' }, () => {
    const keys = [...original.matchAll(/t\('(softwareUpdates\.[^']+)'/g)].map(match => match[1]);
    const chart = fs.readFileSync(path.join(__dirname, 'SoftwareCadenceCard.tsx'), 'utf8');
    const productionClosure = current + chart;
    for (const key of new Set(keys)) assert.ok(productionClosure.includes(`'${key}'`), key);
    for (const binding of [
      'vehicleId={vehicleId ?? undefined}', 'onClick={handleRetry}', 'onRetry={handleRetry}',
      'onPageChange={setPage}', 'pageSize={PAGE_SIZE}', 'total={paginationTotal}',
      'onClick: resetRange', 'getUpdateStatus(u.status)', 'vehicleMap.get(u.vehicle_id)',
      'encodeURIComponent(u.version)', 'target="_blank"', 'rel="noopener noreferrer"',
      'u.scheduled_at && !u.installed_at', 'formatDate(u.installed_at)',
      'formatDate(u.scheduled_at)', 'formatDate(u.created_at)', 't(meta.labelKey, meta.labelFallback)',
    ]) assert.ok(current.includes(binding), binding);
    assert.equal((current.match(/occurrenceId:/g) ?? []).length, 6);
    assert.ok(current.includes('source.retained && retryContent'));
    assert.ok(!current.includes('empty={!data}'));
    assert.ok(!/<(?:button|input|select|textarea|table)\b/.test(current));
    for (const contract of ['key: \'label\'', 'key: \'count\'', 'dataKey="label"', 'dataKey="count"',
      'allowDecimals={false}', 'interval="preserveStartEnd"', 'chartTokens.series[5]',
      'fillOpacity={0.85}', 'maxBarSize={56}', 'dataColumns={dataColumns}', 'data={chartRows}']) {
      assert.ok(chart.includes(contract), contract);
    }
  });
