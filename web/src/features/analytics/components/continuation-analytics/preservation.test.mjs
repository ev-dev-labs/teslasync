import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const repository = fileURLToPath(new URL('../../../../../../', import.meta.url));
const baseline = process.env.ANALYTICS_CONTINUATION_BASELINE;
const source = path => readFileSync(join(repository, ...path.split('\\')), 'utf8');
const frozen = path => readFileSync(join(baseline, ...path.split('\\')), 'utf8');
const normalized = text => text.replace(/\r\n/g, '\n');
const carbon = 'web\\src\\features\\analytics\\components\\carbon-intelligence\\';
const archetypes = 'web\\src\\features\\analytics\\components\\drive-archetypes\\';
const presenters = [
  ...[
    'CarbonAccountingIdentities', 'CarbonCurveCoverage', 'CarbonEvidenceLedger',
    'CarbonGreenTimingScore', 'CarbonHourlyDirectory', 'CarbonLifetimeContext',
    'CarbonMethodology', 'CarbonOpportunityMath', 'CarbonPeriodFootprint',
    'CarbonRecommendation', 'CarbonSectionBody', 'CarbonSourceRow', 'CarbonSourceScopeLedger',
  ].map(name => `${carbon}${name}.tsx`),
  ...[
    'ArchetypeAssignmentDirectory', 'ArchetypeCandidateModels', 'ArchetypeEvidenceLedger',
    'ArchetypeExactAccounting', 'ArchetypeFeatureEvidence', 'ArchetypeHistoryCoverage',
    'ArchetypeMethodology', 'ArchetypeProfiles', 'ArchetypeQueryStatus',
    'ArchetypeSectionBody', 'ArchetypeSeparation', 'ArchetypeSourceDisposition',
  ].map(name => `${archetypes}${name}.tsx`),
];

function parse(path, text) {
  const tree = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  assert.deepEqual(tree.parseDiagnostics, [], `${path} must retain valid TSX`);
  return tree;
}

function fallbackEntries(path, text) {
  const entries = new Set();
  const tree = parse(path, text);
  const visit = node => {
    if (ts.isCallExpression(node) && node.expression.getText(tree) === 't'
      && node.arguments.length >= 2
      && ts.isStringLiteral(node.arguments[0]) && ts.isStringLiteral(node.arguments[1])) {
      entries.add(`${node.arguments[0].text}\0${node.arguments[1].text}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
  return entries;
}

test('both calculation engines retain their prelaunch byte hashes', () => {
  for (const [path, hash] of [
    ['web\\src\\features\\analytics\\lib\\carbonIntelligence.ts', '207579D120037DE5C70DFE4AFD08387D5EE3CCCC9756C8328E764A3EB20914AA'],
    ['web\\src\\features\\analytics\\lib\\driveArchetypes.ts', '936FD91CB9996DEDC20CF7708CD51C5937FF5DEB3710F3585654D2618836A19E'],
  ]) {
    const bytes = readFileSync(join(repository, ...path.split('\\')));
    assert.equal(createHash('sha256').update(bytes).digest('hex').toUpperCase(), hash, path);
  }
});

test('all assigned production presenter bodies retain valid TSX', () => {
  for (const path of [...presenters, 'web\\src\\features\\benchmarks\\components\\ConsentGate.tsx']) {
    parse(path, source(path));
  }
});

test('every original non-chart label, explanation and source-state fallback survives', { skip: !baseline }, () => {
  for (const path of presenters) {
    const current = fallbackEntries(path, source(path));
    for (const entry of fallbackEntries(path, frozen(path))) {
      assert.ok(current.has(entry), `${path} dropped original localized evidence ${entry}`);
    }
  }
});

test('orchestrators, query adapters, display converters and chart engines are byte-preserved', { skip: !baseline }, () => {
  const unchanged = [
    'web\\src\\features\\analytics\\pages\\CarbonIntelligencePage.tsx',
    'web\\src\\features\\analytics\\pages\\DriveArchetypesPage.tsx',
    'web\\src\\features\\benchmarks\\pages\\PrivacyBenchmarksPage.tsx',
    ...['queryState.ts', 'types.ts', 'useCarbonDisplay.ts', 'useCarbonQueryStates.ts'].map(name => carbon + name),
    ...['labels.ts', 'types.ts', 'useDriveArchetypeDisplay.ts'].map(name => archetypes + name),
    ...['CarbonIntensityCurve', 'CarbonMonthlyTrend'].map(name => `${carbon}${name}.tsx`),
    ...[
      'ArchetypeCentroidMap', 'ArchetypeClusterComposition', 'ArchetypeConfidenceDistribution',
      'ArchetypeHourlyProfile', 'ArchetypeMonthlyComposition',
    ].map(name => `${archetypes}${name}.tsx`),
    ...[
      'BenchmarkPercentileChart', 'BenchmarkStatusContent', 'CohortEligibilityPanel',
      'MethodologyPanel', 'MetricComparisonGrid', 'PrivacyBudgetPanel', 'PrivacyControls',
    ].map(name => `web\\src\\features\\benchmarks\\components\\${name}.tsx`),
  ];
  for (const path of unchanged) assert.equal(source(path), frozen(path), path);
});

test('candidate chart adoption changes only its canonical frame and public import', { skip: !baseline }, () => {
  const path = archetypes + 'ArchetypeCandidateModels.tsx';
  const expected = normalized(frozen(path))
    .replace('  ChartContainer,\n', '')
    .replace("} from '@/components/charts';", "} from '@/components/charts';\nimport { ChartCard } from '@/components/layout';")
    .replace('<ChartContainer\n', '<ChartCard\n        size="standard"\n')
    .replace('</ChartContainer>', '</ChartCard>');
  assert.equal(normalized(source(path)), expected);
});

test('consent repair only moves the mismatched source closing tag around the full existing body', { skip: !baseline }, () => {
  const path = 'web\\src\\features\\benchmarks\\components\\ConsentGate.tsx';
  const expected = normalized(frozen(path))
    .replace('          </BenchmarkStatusContent>\n', '')
    .replace('    </LayoutCard>', '      </BenchmarkStatusContent>\n    </LayoutCard>');
  assert.equal(normalized(source(path)), expected);
});
