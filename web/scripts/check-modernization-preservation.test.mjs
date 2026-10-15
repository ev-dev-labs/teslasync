import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { loadTools, extractEvidence, compare, sha256, validateBaseline, sourcePath, run, reconcileCatalogs, capture, VERSION } from './check-modernization-preservation.mjs';

const root = process.env.PRESERVATION_REPO_ROOT;
assert.ok(root, 'Set PRESERVATION_REPO_ROOT to repository with installed TypeScript and existing i18n-source-graph auditor.');
const tools = await loadTools(root);
const fixture = `
import { Detail } from '@/features/demo/Detail';
const Page = lazy(() => import('./features/demo/Page'));
export function Demo() {
  const query = useVehicleState(vehicleId);
  return <div className="old">
    <Route path="/demo" element={<SafeRoute name="Demo"><Page /></SafeRoute>} />
    <Detail />
    <MetricCard label={t('demo.distance', 'Distance')} value={fmtNumber(data.distance_m)} />
    <DataTable tableId="demo.table" />
  </div>;
}
const STORAGE_KEY = 'demo:layout:v1';
localStorage.getItem('demo:theme');
`;
function baseline(text = fixture, file = 'web\\src\\fixture.tsx') {
  const bytes = Buffer.from(text, 'utf8');
  return {
    version: VERSION, scope: 'bounded-source-only', dependencies: [],
    files: [{ path: file, sha256: sha256(bytes), bytes: bytes.toString('base64'), evidence: extractEvidence(text, file, tools) }],
  };
}
const difference = (text, original = fixture, file = 'web\\src\\fixture.tsx') => compare(baseline(original, file), baseline(text, file));
function fails(text, category) {
  const report = difference(text);
  assert.equal(report.exitCode, 1);
  assert.ok(report.diagnostics.some(d => d.category === category), JSON.stringify(report.diagnostics));
}

test('stable exact baseline is deterministic and self-validating', async () => {
  const frozen = baseline();
  assert.deepEqual(frozen, baseline());
  await validateBaseline(frozen, tools);
  assert.equal(compare(frozen, frozen).exitCode, 0);
});
test('presentation classes, fallback label copy, formatting wrapper and CRLF edits are permitted', () => {
  const next = fixture.replace('className="old"', 'className="new p-4"')
    .replace("'Distance'", "'Distance travelled'")
    .replace('fmtNumber(data.distance_m)', 'formatDistance(data.distance_m)')
    .replaceAll('\n', '\r\n');
  const report = difference(next);
  assert.equal(report.exitCode, 0);
  assert.equal(report.sourceDrift.length, 1);
});
test('comments do not alter identities', () => {
  assert.equal(difference('// source comment\n' + fixture.replace('data.distance_m', 'data /* note */.distance_m')).exitCode, 0);
});
test('route removal, duplication, rename and target replacement fail', () => {
  const route = '<Route path="/demo" element={<SafeRoute name="Demo"><Page /></SafeRoute>} />';
  fails(fixture.replace(route, ''), 'routes');
  fails(fixture.replace(route, route + route), 'routes');
  fails(fixture.replace('/demo"', '/gone"'), 'routes');
  fails(fixture.replace('<Page />', '<EmptyState />'), 'routes');
});
test('route lexical ordering is protected even for identical multisets', () => {
  const first = '<Route path="/a" element={<A />} />';
  const second = '<Route path="/b" element={<B />} />';
  const report = difference(`const r = <>${second}${first}</>;`, `const r = <>${first}${second}</>;`);
  assert.equal(report.exitCode, 1);
  assert.ok(report.diagnostics.some(d => d.reason.includes('order')));
});
test('feature component removal/duplication fails', () => {
  fails(fixture.replace('<Detail />', ''), 'components');
  fails(fixture.replace('<Detail />', '<Detail /><Detail />'), 'components');
});
test('metric missing, duplicate, source changed or key changed fails', () => {
  const metric = "<MetricCard label={t('demo.distance', 'Distance')} value={fmtNumber(data.distance_m)} />";
  fails(fixture.replace(metric, ''), 'metrics');
  fails(fixture.replace(metric, metric + metric), 'metrics');
  fails(fixture.replace('data.distance_m', 'data.energy_wh'), 'metrics');
  fails(fixture.replace("'demo.distance'", "'demo.energy'"), 'metrics');
});
test('hook arguments, hook identity, request endpoint/options/type changes fail', () => {
  fails(fixture.replace('useVehicleState(vehicleId)', 'useVehicleState(0)'), 'hooks');
  fails(fixture.replace('useVehicleState', 'useVehicles'), 'hooks');
  const original = "export function useRead() { return request<Vehicle>('/vehicles', { method: 'GET' }); }";
  for (const next of [
    original.replace('/vehicles', '/charging'),
    original.replace("'GET'", "'POST'"),
    original.replace('<Vehicle>', '<Vehicle[]>'),
  ]) assert.equal(difference(next, original, 'web\\src\\api\\hooks\\useRead.ts').exitCode, 1);
});
test('API property optionality, type and removal fail; formatting is permitted', () => {
  const before = 'export interface Vehicle { distance_m: number; name?: string | null; }';
  for (const after of [
    before.replace('distance_m: number;', ''),
    before.replace('number', 'string'),
    before.replace('name?', 'name'),
  ]) assert.equal(difference(after, before, 'web\\src\\api\\types.ts').exitCode, 1);
  assert.equal(difference(before.replaceAll(';', ';\n'), before, 'web\\src\\api\\types.ts').exitCode, 0);
});
test('persistent JSX IDs, preference storage keys and key constants fail', () => {
  fails(fixture.replace('demo.table', 'new.table'), 'persistence');
  fails(fixture.replace('demo:theme', 'new:theme'), 'persistence');
  fails(fixture.replace('demo:layout:v1', 'demo:layout:v2'), 'persistence');
});
test('dynamic imports are not erased or silently accepted', () => {
  const before = 'const Page = lazy(() => import(modulePath));';
  const report = difference(before, before);
  assert.equal(report.exitCode, 2);
  assert.match(report.unknowns[0].reason, /Nonliteral/);
  assert.equal(difference('const Page = () => null;', before).exitCode, 1);
});
test('metric indirect source and spread remain explicit unknowns', () => {
  const text = "const node = <MetricCard {...props} label={t('x', 'X')} value={value} />;";
  const report = difference(text, text);
  assert.equal(report.exitCode, 2);
  assert.ok(report.unknowns.some(u => u.reason.includes('Spread')));
  assert.ok(report.unknowns.some(u => u.reason.includes('Indirect')));
  assert.ok(report.unknowns.every(u => u.expression));
});
test('baseline Unicode and CRLF bytes are preserved, not normalized', async () => {
  const text = "const STORAGE_KEY = 'préférence:🧭';\r\n";
  const b = baseline(text, 'web\\src\\fixture.ts');
  assert.equal(Buffer.from(b.files[0].bytes, 'base64').toString('utf8'), text);
  assert.notEqual(b.files[0].sha256, sha256(Buffer.from(text.replaceAll('\r\n', '\n'))));
  await validateBaseline(b, tools);
});
test('baseline tampered bytes or structured evidence fail explicitly', async () => {
  const a = baseline();
  a.files[0].bytes = Buffer.from('different').toString('base64');
  await assert.rejects(validateBaseline(a, tools), /byte\/hash mismatch/);
  const b = baseline();
  b.files[0].evidence.metrics = [];
  await assert.rejects(validateBaseline(b, tools), /evidence\/bytes mismatch/);
});
test('parser errors fail instead of partial evidence', () => {
  assert.throws(() => extractEvidence('const = <', 'broken.tsx', tools), /parser failure/);
});
test('missing scoped input and lost resolved import target are actionable', () => {
  const b = baseline();
  const missing = compare(b, { ...b, files: [] });
  assert.equal(missing.exitCode, 1);
  assert.ok(missing.diagnostics.some(d => d.reason.includes('Missing')));
  b.dependencies = [{ from: b.files[0].path, specifier: './Page', target: 'web\\src\\Page.tsx', scoped: false }];
  const after = { ...b, dependencies: [] };
  assert.ok(compare(b, after).diagnostics.some(d => d.category === 'reachability'));
});
test('scope paths cannot escape root', () => {
  assert.throws(() => sourcePath(root, '..\\outside.ts'), /escapes/);
  assert.throws(() => sourcePath(root, 'C:\\outside.ts'), /relative/);
});
test('CLI invalid inputs and missing values fail without writes', async () => {
  await assert.rejects(run(['other']), /Usage/);
  await assert.rejects(run(['capture', '--root']), /missing value/);
  await assert.rejects(run(['check', '--root', root, '--wat', 'x']), /Invalid/);
  await assert.rejects(run(['check', '--root', root]), /requires --baseline/);
  await assert.rejects(run(['capture', '--root', root, '--root', root]), /duplicate/);
  await assert.rejects(run(['check', '--root', root, '--baseline', 'missing-preservation-input.json']), /ENOENT/);
});
test('CLI returns standard nonzero failure and diagnostic', () => {
  const child = spawnSync(process.execPath, [fileURLToPath(new URL('./check-modernization-preservation.mjs', import.meta.url)), 'invalid'], { encoding: 'utf8' });
  assert.equal(child.status, 1);
  assert.match(child.stderr, /modernization-preservation: Usage/);
});
function catalogProbe(kind, document, snapshot = baseline()) {
  const bytes = Buffer.from(JSON.stringify(document));
  return reconcileCatalogs([{ kind, path: 'in-memory-frozen-input', sha256: sha256(bytes) }], snapshot, tools, () => bytes);
}
test('canonical original metric source survives stale lines but not duplicate/source loss', () => {
  const original = { source_occurrences: [{
    id: 'original-source-id-NOT-production', file: 'web\\src\\fixture.tsx', line: 900,
    owner: 'Demo', existing_props: { label: "t('demo.distance', 'Distance')", value: 'fmtNumber(data.distance_m)' },
  }] };
  const stable = catalogProbe('metrics', original);
  assert.equal(stable.diagnostics.length, 0);
  assert.deepEqual(stable.probes[0].originalLines, [900]);
  assert.notDeepEqual(stable.probes[0].currentLines, [900]);
  assert.equal(catalogProbe('metrics', original, baseline(fixture.replace('data.distance_m', 'data.energy_wh'))).diagnostics.length, 1);
  const metric = "<MetricCard label={t('demo.distance', 'Distance')} value={fmtNumber(data.distance_m)} />";
  assert.equal(catalogProbe('metrics', original, baseline(fixture.replace(metric, metric + metric))).diagnostics.length, 1);
});
test('canonical route targets and multiplicity detect loss/duplicates despite present path', () => {
  const document = { declarations: [{ id: 'frozen-route', source_file: 'web\\src\\fixture.tsx', source_line: 900, route_pattern: '/demo', component: 'Page' }] };
  assert.equal(catalogProbe('routes', document).diagnostics.length, 0);
  assert.equal(catalogProbe('routes', document, baseline(fixture.replace('<Page />', '<EmptyState />'))).diagnostics.length, 1);
  const route = '<Route path="/demo" element={<SafeRoute name="Demo"><Page /></SafeRoute>} />';
  assert.equal(catalogProbe('routes', document, baseline(fixture.replace(route, route + route))).diagnostics.length, 1);
});
test('canonical unknowns, invalid catalog schemas and hash drift are never normalized', () => {
  const unknown = catalogProbe('metrics', { source_occurrences: [{ id: 'unknown', file: 'web\\src\\fixture.tsx', owner: 'Demo', line: 1, label_expression: 'UNKNOWN' }] });
  assert.equal(unknown.unknowns.length, 1);
  assert.throws(() => catalogProbe('metrics', {}), /Invalid metric/);
  const bytes = Buffer.from('{}');
  assert.throws(() => reconcileCatalogs([{ kind: 'metrics', path: 'memory', sha256: '0'.repeat(64) }], baseline(), tools, () => bytes), /Frozen catalog hash mismatch/);
});
test('preference field and recognized persistent enum/version changes fail', () => {
  const original = "export interface ProductPreferences { landingPage: string; } const PRODUCT_PERSONAS = ['owner', 'analyst']; const PRODUCT_PREFERENCES_VERSION = 1;";
  for (const after of [
    original.replace('landingPage', 'homepage'),
    original.replace("'analyst'", "'viewer'"),
    original.replace('VERSION = 1', 'VERSION = 2'),
  ]) assert.equal(difference(after, original, 'web\\src\\lib\\productPreferences.ts').exitCode, 1);
});
test('nested root route paths match canonical URLs without altering raw baseline bytes', () => {
  const text = 'const r = <Route path="/" element={<Layout />}><Route path="demo" element={<Page />} /><Route index element={<Home />} /></Route>;';
  const evidence = extractEvidence(text, 'fixture.tsx', tools);
  assert.deepEqual(evidence.routes.map(r => r.pattern), ['/', '/demo', '/']);
  assert.equal(catalogProbe('routes', { declarations: [
    { id: 'root', source_file: 'web\\src\\fixture.tsx', source_line: 1, route_pattern: '/', component: 'Layout' },
    { id: 'page', source_file: 'web\\src\\fixture.tsx', source_line: 1, route_pattern: '/demo', component: 'Page' },
    { id: 'index', source_file: 'web\\src\\fixture.tsx', source_line: 1, route_pattern: '/', component: 'Home' },
  ] }, baseline(text)).diagnostics.length, 0);
});
test('MetricBar source identities are included rather than reported as lost', () => {
  const text = 'export function Demo() { return <MetricBar label={r.name} value={r.distance} />; }';
  const document = { source_occurrences: [{ id: 'bar', file: 'web\\src\\fixture.tsx', line: 90, owner: 'Demo', existing_props: { label: 'r.name', value: 'r.distance' } }] };
  assert.equal(catalogProbe('metrics', document, baseline(text)).diagnostics.length, 0);
  assert.equal(difference(text.replace('r.distance', 'r.energy'), text).exitCode, 1);
});
test('capture rejects empty, missing and duplicate scoped inputs without writes', async () => {
  await assert.rejects(capture(root, [], tools), /1–40/);
  await assert.rejects(capture(root, ['web\\src\\__missing_preservation_fixture__.ts'], tools), /ENOENT/);
  await assert.rejects(capture(root, ['web\\src\\api\\dataState.ts', 'web\\src\\api\\dataState.ts'], tools), /Duplicate scope/);
});
test('named imported hook aliases retain logical identity, args and removal diagnostics', () => {
  const text = "import { useVehicles as getVehicles } from '@/api/hooks/useVehicles'; export function Demo() { return getVehicles(7); }";
  const evidence = extractEvidence(text, 'fixture.ts', tools);
  assert.equal(evidence.hooks[0].callee, 'useVehicles');
  assert.equal(evidence.hooks[0].localCallee, 'getVehicles');
  assert.equal(evidence.hooks[0].importedFrom, '@/api/hooks/useVehicles');
  assert.equal(difference(text.replace('getVehicles(7)', 'getVehicles(8)'), text).exitCode, 1);
  assert.equal(difference(text.replace('return getVehicles(7);', 'return null;'), text).exitCode, 1);
  assert.equal(difference(text.replace('useVehicles as', 'useVehicleState as'), text).exitCode, 1);
});
test('request aliases retain endpoint, options, type arguments and removal diagnostics', () => {
  const text = "import { request as load } from '@/api/client'; export function Demo() { return load<Vehicle>('/vehicles', { method: 'GET' }); }";
  const evidence = extractEvidence(text, 'fixture.ts', tools);
  assert.equal(evidence.api[0].callee, 'request');
  assert.equal(evidence.api[0].localCallee, 'load');
  for (const next of [
    text.replace('<Vehicle>', '<Vehicle[]>'),
    text.replace("'/vehicles'", "'/drives'"),
    text.replace("'GET'", "'POST'"),
    text.replace("return load<Vehicle>('/vehicles', { method: 'GET' });", 'return null;'),
  ]) {
    const report = difference(next, text);
    assert.equal(report.exitCode, 1);
    assert.ok(report.diagnostics.some(d => d.category === 'api'));
  }
});
test('unrecognized imported API/hook helpers are unknown, never query coverage', () => {
  const text = "import { calculate as useVehicles } from '@/api/helpers'; const value = useVehicles(7);";
  const evidence = extractEvidence(text, 'fixture.ts', tools);
  assert.equal(evidence.hooks.length, 0);
  assert.equal(evidence.api.length, 0);
  assert.match(evidence.unknowns[0].reason, /Unrecognized imported/);
  assert.equal(difference(text, text).exitCode, 2);
  assert.equal(difference(text.replace('useVehicles(7)', 'useVehicles(8)'), text).exitCode, 2);
  assert.equal(difference(text.replace('useVehicles(7)', 'null'), text).exitCode, 2);
});
const ownedV3 = process.env.PRESERVATION_TEST_ARTIFACT_ROOT;
const parentArtifactDir = process.env.PRESERVATION_FROZEN_ARTIFACT_ROOT;
assert.ok(ownedV3, 'Set PRESERVATION_TEST_ARTIFACT_ROOT to an explicitly owned staging directory, never a live repository directory.');
assert.ok(parentArtifactDir, 'Set PRESERVATION_FROZEN_ARTIFACT_ROOT to the retained v1/v2 evidence directory (read-only).');
const publicationFixtureDir = join(ownedV3, 'publication-regression-fixtures', randomUUID());
const originalEvidenceHashes = readdirSync(parentArtifactDir)
  .filter(name => /^(?:baseline\.source\.v[12]\.json|preservation-report(?:\.v2|\.final)?\.json|validator-receipt(?:\.v2|\.final)?\.txt|node-test-receipt\.txt)$/.test(name))
  .map(name => [name, sha256(readFileSync(join(parentArtifactDir, name)))]);
function publicationFixture(name, bytes) {
  mkdirSync(publicationFixtureDir, { recursive: true });
  const target = join(publicationFixtureDir, name);
  writeFileSync(target, bytes, { flag: 'wx' });
  return target;
}
test('report publication refuses existing proof, other/current baseline and source; all byte hashes unchanged', async () => {
  const files = [
    publicationFixture('existing-proof.json', '{"proof":"préservé"}\r\n'),
    publicationFixture('other-frozen-baseline.json', '{"baseline":"immutable"}\r\n'),
    publicationFixture('current-frozen-baseline.json', JSON.stringify(baseline()) + '\n'),
    publicationFixture('source-fixture.ts', "export const original = '🧭';\r\n"),
    join(parentArtifactDir, 'baseline.source.v2.json'),
    join(parentArtifactDir, 'preservation-report.final.json'),
    fileURLToPath(new URL('./check-modernization-preservation.mjs', import.meta.url)),
  ];
  const hashes = files.map(file => sha256(readFileSync(file)));
  for (const target of files) {
    await assert.rejects(run(['check', '--root', root, '--baseline', files[2], '--report', target]), /Refusing to overwrite report/);
  }
  assert.deepEqual(files.map(file => sha256(readFileSync(file))), hashes);
});
test('Windows case-variant report publication refuses current baseline without changing bytes', { skip: process.platform !== 'win32' }, async () => {
  const file = publicationFixture('CaseSensitiveBaseline.json', JSON.stringify(baseline()) + '\n');
  const before = sha256(readFileSync(file));
  await assert.rejects(run(['check', '--root', root, '--baseline', file, '--report', file.toUpperCase()]), /Refusing to overwrite report/);
  assert.equal(sha256(readFileSync(file)), before);
});
test('all original v1/v2 evidence filenames and hashes remain untouched by publication controls', () => {
  assert.ok(originalEvidenceHashes.length >= 7);
  for (const [file, hash] of originalEvidenceHashes) assert.equal(sha256(readFileSync(join(parentArtifactDir, file))), hash);
});
