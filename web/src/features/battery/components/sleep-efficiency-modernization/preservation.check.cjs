/* Source-only guard. No application boot, browser, compiler program or test discovery. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const ts = require('typescript');

const artifacts = process.argv[2];
assert.ok(artifacts, 'Pass the immutable original-current artifact directory');
const root = path.resolve(__dirname, '../../../../../..');
const page = 'web/src/features/battery/pages/SleepEfficiencyPage.tsx';
const oldPrivate = 'web/src/features/battery/components/sleep-efficiency/';
const newPrivate = 'web/src/features/battery/components/sleep-efficiency-modernization/';
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const original = rel => fs.readFileSync(path.join(artifacts, 'original-current', rel), 'utf8');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const baseline = JSON.parse(fs.readFileSync(path.join(artifacts, 'original-current-hashes.json'), 'utf8'));
const source = (name, text) => {
  const parsed = ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  assert.equal(parsed.parseDiagnostics.length, 0, `Parse errors: ${name}`);
  return parsed;
};
const walk = (node, visit) => { visit(node); ts.forEachChild(node, child => walk(child, visit)); };
const printer = ts.createPrinter({ removeComments: true });
const calls = (text, name) => {
  const file = source(page, text);
  const values = [];
  walk(file, node => {
    if (ts.isCallExpression(node) && node.expression.getText(file) === name) {
      values.push(printer.printNode(ts.EmitHint.Unspecified, node, file));
    }
  });
  return values;
};
const sections = [
  'SleepEvidenceBand', 'TransitionDestinationChart', 'TransitionCompositionPanel',
  'DwellDurationChart', 'SleepEfficiencyDiagnostics', 'TransitionDiversityDiagnostics',
  'SentryComparisonChart', 'StateEvidenceDirectory', 'SentryProjectionContext',
  'DrainEventProfile', 'DrainEventDirectory', 'DataAvailabilityMatrix',
  'RangeSourceCoverage', 'SleepMethodologyPanel',
];
const currentPage = read(page);
const oldPage = original(page);
assert.equal((read(newPrivate + 'SleepEvidenceOverview.tsx').match(/occurrenceId:/g) ?? []).length, 7);
const mapped = sections.map(name => name === 'SleepEvidenceBand' ? 'SleepEvidenceOverview' : name);
for (const name of sections) assert.equal((oldPage.match(new RegExp(`<${name}\\b`, 'g')) ?? []).length, 1);
for (const name of mapped) assert.equal((currentPage.match(new RegExp(`<${name}\\b`, 'g')) ?? []).length, 1);
for (const name of ['useSleepEfficiency', 'useRangeState', 'analyzeSleepRange', 'analyzeSleepEfficiency']) {
  assert.deepEqual(calls(currentPage, name), calls(oldPage, name), `${name} operands/bounds changed`);
}
assert.ok(currentPage.includes('const [frozenNowMs] = useState(() => Date.now())'));
assert.ok(currentPage.includes('requestedRange.inclusiveDays ?? DEFAULT_SLEEP_RANGE_DAYS'));
assert.equal(calls(currentPage, 'useDataState').length, 1, 'Keep the single real independent sleep source');
assert.ok(!currentPage.includes('empty=') && !currentPage.includes('error={') && !currentPage.includes('loading={'),
  'Page shell must not replace its independent source sections');
let immutableDomainFiles = 0;
for (const file of baseline.files.filter(file =>
  file.path.startsWith(oldPrivate) ||
  file.path.startsWith('web/src/features/battery/lib/sleepEfficiency') ||
  ['web/src/api/hooks/useEnergy.ts', 'web/src/types/energy.ts', 'internal/api/sleep/handler.go'].includes(file.path))) {
  assert.equal(sha(fs.readFileSync(path.join(root, file.path))), file.sha256, `Read-only domain drift: ${file.path}`);
  immutableDomainFiles++;
}
for (const [oldName, newName] of [
  ['SleepEvidenceBand', 'SleepEvidenceOverview'],
  ['StateEvidenceDirectory', 'StateEvidenceDirectory'],
  ['DrainEventDirectory', 'DrainEventDirectory'],
]) {
  const before = original(`${oldPrivate}${oldName}.tsx`);
  const after = read(`${newPrivate}${newName}.tsx`);
  const keys = [...before.matchAll(/t\(\s*'([^']+)'/g)].map(match => match[1]);
  for (const key of keys) assert.ok(after.includes(`'${key}'`), `Lost source translation/meaning: ${key}`);
  if (oldName.endsWith('Directory')) {
    const fields = text => [...text.matchAll(/key:\s*'([^']+)'/g)].map(match => match[1]);
    assert.deepEqual(fields(after), fields(before), `Lost directory fields: ${oldName}`);
    assert.equal((after.match(/mobilePresentation=/g) ?? []).length, 1);
    const tableId = before.match(/tableId="([^"]+)"/)[1];
    assert.ok(after.includes(`tableId="${tableId}"`));
    const bodyName = 'SleepEfficiencySectionBody';
    assert.equal((after.match(new RegExp(`<${bodyName}\\b`, 'g')) ?? []).length, 1);
  }
}
const productionPaths = [page, ...fs.readdirSync(__dirname)
  .filter(name => /\.(ts|tsx)$/.test(name) && !name.includes('.test.') && !name.includes('.fixture.'))
  .map(name => newPrivate + name)];
const counts = { inlineStyles: 0, rawControls: 0, directLibraries: 0, camelCaseWire: 0 };
for (const rel of productionPaths) {
  const text = read(rel);
  source(rel, text);
  counts.inlineStyles += (text.match(/style=\{\{/g) ?? []).length;
  counts.rawControls += (text.match(/<(?:button|input|textarea|select|table)\b/g) ?? []).length;
  counts.directLibraries += (text.match(/from ['"](?:recharts|react-leaflet|framer-motion)['"]/g) ?? []).length;
  counts.camelCaseWire += (text.match(/vehicleId=/g) ?? []).length;
}
assert.deepEqual(Object.values(counts), [0, 0, 0, 0]);
const hook = read('web/src/api/hooks/useEnergy.ts');
assert.ok(hook.includes('`/analytics/sleep?${params.toString()}`'));
assert.ok(read('internal/api/router.go').includes('r.Get("/analytics/sleep", sleepHandler.GetSleepAnalytics)'));
const replaced = new Set(['SleepEvidenceBand.tsx', 'StateEvidenceDirectory.tsx', 'DrainEventDirectory.tsx']);
const closureBase = baseline.files.filter(file => !file.path.includes('.test.') &&
  (file.path === page || file.path.startsWith(oldPrivate) || file.path === 'web/src/features/battery/lib/sleepEfficiencyAnalysis.ts'));
const lines = text => text.split(/\r?\n/).filter(line => line.trim()).length;
const beforeLines = closureBase.reduce((sum, file) => sum + lines(original(file.path)), 0);
const retainedPaths = closureBase.filter(file => file.path !== page && !replaced.has(path.basename(file.path))).map(file => file.path);
const afterLines = [...retainedPaths, ...productionPaths].reduce((sum, rel) => sum + lines(read(rel)), 0);
assert.ok(afterLines >= beforeLines * 0.7, 'Production closure below 70%');
assert.ok(lines(currentPage) >= lines(oldPage) * 0.7, 'Page below 70% without extraction evidence');
console.log(JSON.stringify({
  status: 'PASS_SOURCE_ONLY', immutableDomainFiles, sections: { original: sections.length, current: mapped.length },
  metrics: { original: 7, current: (read(newPrivate + 'SleepEvidenceOverview.tsx').match(/occurrenceId:/g) ?? []).length },
  violationCounts: counts, route: '/analytics/sleep',
  closureNonblankLines: { original: beforeLines, current: afterLines, ratio: afterLines / beforeLines },
  pageLines: { original: oldPage.split(/\r?\n/).length, current: currentPage.split(/\r?\n/).length },
  runtime: 'NOTRUN', typescriptProgram: 'NOTRUN',
}, null, 2));
