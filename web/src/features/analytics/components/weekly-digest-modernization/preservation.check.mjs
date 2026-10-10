/**
 * Bounded Node source/pure-helper checks. No app bootstrap, HTTP, browser,
 * generated catalogs or project test runner. Set WEEKLY_DIGEST_ACQUISITION
 * to the immutable acquisition root to check current-source byte preservation.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const directory = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(directory, '../../../../../..');
const require = createRequire(path.join(repo, 'web/package.json'));
const ts = require('typescript');
const read = name => readFileSync(path.join(directory, name), 'utf8');
const page = readFileSync(path.join(repo, 'web/src/features/analytics/pages/WeeklyDigestPage.tsx'), 'utf8');
const compiled = ts.transpileModule(read('presentation.ts'), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { presentedMetric, weeklyPeriod } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`
);

test('specialist text bridge never rounds, converts, reparses or recases values', () => {
  for (const value of ['0', '—', '-2.50 pts', '+1.2 km', '0,125 Wh/km', '€12.345,67', '1.4×']) {
    const result = presentedMetric('occurrence', 'Domain label', value, 'icon', 'delta');
    assert.deepEqual(result, {
      occurrenceId: 'occurrence', metricId: 'text', rawValue: value,
      label: 'Domain label', description: 'Domain label', context: 'icon',
      comparisonContent: 'delta',
    });
  }
  assert.equal(presentedMetric('empty', 'Label', '').rawValue, '—');
});

test('period metadata adds seven local calendar days without mutating inputs', () => {
  for (const date of ['2026-03-02T00:00:00', '2026-10-26T00:00:00', '2026-12-28T00:00:00']) {
    const start = new Date(date);
    const original = start.getTime();
    const expectedEnd = new Date(start);
    expectedEnd.setDate(expectedEnd.getDate() + 7);
    const result = weeklyPeriod(start, 'Selected week', 'America/Los_Angeles', 'Available history');
    assert.equal(result.kind, 'analysis');
    assert.equal(result.start, start.toISOString());
    assert.equal(result.endExclusive, expectedEnd.toISOString());
    assert.equal(result.completeness, 'unknown');
    assert.equal(result.label, 'Selected week');
    assert.equal(result.provenance, 'Available history');
    assert.equal(start.getTime(), original);
  }
  assert.equal(weeklyPeriod(new Date(2026, 0, 5), '', 'UTC', 'History').label, '—');
});

test('all eight digest content occurrences stay ordered and individually wired', () => {
  const ids = [...page.matchAll(/id: '([^']+)'/g)].map(match => match[1])
    .filter(id => !['drive-history', 'charging-history', 'alert-history', 'fsd-insights'].includes(id));
  assert.deepEqual(ids, [
    'week-navigation', 'week-summary', 'driving', 'charging',
    'supervised-driving', 'battery', 'alerts', 'week-comparison',
  ]);
  for (const callback of ['refetchDrives', 'refetchCharging', 'refetchAlerts', 'refetchFsd', 'refetchAll']) {
    assert.ok(page.includes(`onRetry={${callback}}`), callback);
  }
  assert.match(page, /<AIDigestNarration vehicleId=\{aiVehicleId\} \/>/);
  assert.match(page, /isReady: !fsdLoading && !fsdError/);
  assert.match(page, /selectedVehicleId !== '' && Number\.isFinite\(parsedVehicleId\)/);
  assert.match(page, /query=\{freshnessQueries\}/);
  assert.match(page, /dataSources=\{dataSources\}/);
  assert.doesNotMatch(page, /empty=\{/);
});

test('all domain calculations, daily series, legends and drilldown survive', () => {
  const driving = read('DrivingPanel.tsx');
  const charging = read('ChargingPanel.tsx');
  const battery = read('BatteryPanel.tsx');
  const alerts = read('AlertsPanel.tsx');
  const fsd = read('FsdPanel.tsx');
  assert.match(driving, /convertDistanceFromSI\(entry\.distanceM \?\? 0, unitPrefs\.distance\)/);
  assert.match(driving, /\(metrics\.topDrive\.energyUsedWh \?\? 0\) \/ metrics\.topDrive\.distanceM/);
  for (const property of ['startTs', 'distanceM', 'durationS']) assert.ok(driving.includes(`metrics.topDrive.${property}`));
  assert.match(charging, /convertEnergyFromSI\(entry\?\.energyWh \?\? 0, unitPrefs\.energy\)/);
  assert.match(charging, /name=\{t\('analytics\.weeklyDigest\.energyAdded', 'Energy added'\)\}/);
  assert.match(charging, /\(metrics\.prevChargeEnergyWh \?\? 0\) > 0/);
  assert.match(battery, /const EST_RANGE_M_PER_WH = 5\.5/);
  assert.match(battery, /Math\.round\(metrics\.batteryStart \?\? 0\)/);
  assert.match(battery, /Math\.round\(metrics\.batteryEnd \?\? 0\)/);
  assert.match(alerts, /Object\.entries\(byType\)\.map/);
  assert.match(alerts, /<Cell key=\{entry\.name\} fill=\{entry\.color\} \/>/);
  assert.match(alerts, /<ChartLegend verticalAlign="bottom" \/>/);
  for (const radius of ['innerRadius={55}', 'outerRadius={90}', 'paddingAngle={3}']) assert.ok(alerts.includes(radius));
  assert.match(fsd, /fsdDistanceM == null/);
  assert.match(fsd, /share == null \? '—'/);
  assert.match(fsd, /to="\/fsd\?days=7"/);
  assert.match(fsd, /These are cumulative counter changes, not exact FSD engagement\. Absence is not zero\./);
});

test('shared layout/stats own presentation with no private layout or formatting engine', () => {
  const sources = readdirSync(directory).filter(name => /\.(ts|tsx)$/.test(name) && !name.includes('.test.'));
  for (const name of sources) {
    const source = read(name);
    assert.doesNotMatch(source, /new ResizeObserver|grid-cols-|from ['"](?:recharts|react-leaflet|framer-motion)['"]/);
    assert.doesNotMatch(source, /<(?:button|input|select|textarea|table)\b|style=\{\{/);
    assert.doesNotMatch(source, /\b(?:fetch|request)\(/);
  }
  assert.match(page, /<PageLayout/);
  assert.match(read('DigestSummary.tsx'), /<StatStrip/);
  for (const name of ['DrivingPanel.tsx', 'ChargingPanel.tsx', 'BatteryPanel.tsx', 'FsdPanel.tsx']) {
    assert.match(read(name), /<StatGroup/);
    assert.match(read(name), /<(?:LayoutCard|ChartCard)/);
  }
});

const acquisition = process.env.WEEKLY_DIGEST_ACQUISITION;
test('acquired original digest helpers/hooks/presenters/tests remain byte-identical', {
  skip: acquisition ? false : 'Set WEEKLY_DIGEST_ACQUISITION for current-source acquisition proof',
}, () => {
  const manifest = JSON.parse(readFileSync(path.join(acquisition, 'acquisition.json'), 'utf8'));
  for (const file of manifest.files.filter(file => !file.path.endsWith('/WeeklyDigestPage.tsx'))) {
    const bytes = readFileSync(path.join(repo, file.path));
    assert.equal(bytes.length, file.bytes, file.path);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), file.sha256, file.path);
  }
  const original = readFileSync(
    path.join(acquisition, 'acquisition/web/src/features/analytics/pages/WeeklyDigestPage.tsx'), 'utf8',
  );
  const originalLogic = original.slice(original.indexOf('  const { t }'), original.indexOf('\n\n  return ('));
  const currentLogic = page.slice(page.indexOf('  const { t }'), page.indexOf('  // Period metadata'));
  assert.equal(currentLogic.trim(), originalLogic.trim(), 'Original orchestration preserved verbatim');
});
