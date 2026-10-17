/** Small source/pure-helper checks only: not a project audit or mounted suite. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const owned = fileURLToPath(new URL('.', import.meta.url));
const read = name => readFileSync(new URL(name, import.meta.url), 'utf8');
const page = read('../../pages/YearReviewPage.tsx');
const helperJs = ts.transpileModule(read('yearReviewPresentation.ts'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText;
const exports = {};
new Function('exports', helperJs)(exports);

test('original peak-hour policy survives valid, missing and malformed values', () => {
  for (const [raw, hour12, isPM] of [
    [0, 12, false], [12, 12, true], [23, 11, true], [24, 12, false],
    [-1, 11, true], [13.9, 1, true], [null, 12, false], [NaN, 12, false], [Infinity, 12, false],
  ]) assert.deepEqual(exports.to12Hour(raw), { hour12, isPM });
});
test('original month clamp/locale policy and all 12 labels survive', () => {
  assert.equal(exports.monthShortLabel(null, 'en-US'), 'Jan');
  assert.equal(exports.monthShortLabel(-4, 'en-US'), 'Jan');
  assert.equal(exports.monthShortLabel(99, 'en-US'), 'Dec');
  assert.equal(exports.monthShortLabel(Infinity, 'en-US'), 'Jan');
  assert.equal(exports.monthShortLabel(3.6, 'en-US'), 'Apr');
  assert.equal(exports.monthShortLabel(3, 'de-DE'), 'Mär');
  assert.equal(new Set(Array.from({ length: 12 }, (_, i) => exports.monthShortLabel(i + 1, 'en-US'))).size, 12);
});
test('original compact duration policy survives rounding boundaries and invalid values', () => {
  for (const [raw, expected] of [[24, '24m'], [59.6, '1h 0m'], [119.7, '2h 0m'],
    [-1, '0m'], [NaN, '0m'], [Infinity, '0m'], [1441, '24h 1m']])
    assert.equal(exports.recordDuration(raw), expected);
});
test('all six annual sections, all record operands and unchanged vehicle/year acquisition remain', () => {
  assert.equal((page.match(/<Section\b/g) ?? []).length, 6);
  for (const field of ['longest_drive', 'shortest_drive', 'most_efficient_drive', 'least_efficient_drive',
    'total_distance_km', 'total_drives', 'total_energy_kwh', 'total_charge_sessions', 'gas_savings',
    'co2_offset_kg', 'fastest_speed_kmh', 'hottest_drive_temp_c', 'coldest_drive_temp_c', 'comparisons'])
    assert.ok(page.includes(field), `missing field ${field}`);
  assert.ok(page.includes('useYearReview(year, vehicleIdParam || undefined)'));
  assert.ok(page.includes('const year = Number(yearParam) || currentYear'));
  assert.ok(page.includes('?vehicle_id=${vehicleIdParam}'));
  assert.ok(page.includes('disabled={year >= currentYear}'));
  assert.ok(page.includes('navigate(-1)'));
  assert.ok(page.includes('vehicleId={vehicleIdParam ? Number(vehicleIdParam) : undefined}'));
  assert.ok(!page.includes('RangePicker') && !page.includes('VehicleSelect'));
  assert.ok(page.indexOf('if (data) return content(data)') < page.indexOf('if (isError) return'));
});
test('monthly source series, rounding, axes, tooltip, legend key and export identity survive', () => {
  const source = read('YearMonthlyActivity.tsx');
  for (const fragment of ['monthly_stats ?? []', 'drives: m.drives ?? 0',
    '(m.distance_km ?? 0) * 1000', 'Math.round(m.energy_kwh ?? 0)',
    "useHiddenSeries('year-monthly-chart')", 'chartKey="year-monthly-chart"',
    'exportFilename="year-review-monthly"', 'dataKey="drives"', 'dataKey="distance"',
    'yAxisId="left"', 'yAxisId="right"', '<ChartTooltip', '<ChartLegend', '{chartGrid}',
    "key: 'month'", "key: 'drives'", "key: 'distance'", "key: 'energy'"])
    assert.ok(source.includes(fragment), fragment);
  assert.ok(source.includes('<ChartContainer') && source.includes('        exportable'));
});
test('charging connector filtering and identity-bound palette plus accessible table survive', () => {
  const source = read('YearChargingMix.tsx');
  for (const fragment of ['supercharger_pct ?? 0', 'dc_fast_pct ?? 0', 'ac_other_pct ?? 0',
    "color: '#f59e0b'", "color: '#6366f1'", "color: '#94a3b8'", 'filter(s => s.value > 0)',
    'Math.round(data.avg_charge_start_soc ?? 0)', 'share: Math.round(s.value)',
    'innerRadius={52}', 'outerRadius={82}', 'paddingAngle={3}', 'fill={s.color}', '<ChartTooltip'])
    assert.ok(source.includes(fragment), fragment);
});
test('savings/environment derivations and specialist display contracts survive', () => {
  const savings = read('YearSavings.tsx');
  for (const fragment of ['safeNumber(data.gas_savings)', 'safeNumber(data.total_charging_cost)',
    'savings + electric', 'gasEquiv > 0 ? gasEquiv : 1', 'Math.max(0, Math.round(savings / 5))'])
    assert.ok(savings.includes(fragment), fragment);
  const environment = read('YearEnvironment.tsx');
  assert.ok(environment.includes('Math.max(0, Math.round(co2 / 21))'));
  assert.ok(environment.includes('Math.min(trees, 30)'));
  for (const file of ['YearPatterns.tsx', 'YearDriveRecord.tsx']) {
    assert.ok(read(file).includes('1.609344'));
    assert.ok(read(file).includes("distanceUnit === 'mi' ? 'Wh/mi' : 'Wh/km'"));
  }
  assert.ok(read('YearDriveRecord.tsx').includes('efficiencyWhKm > 0'));
  assert.ok(read('YearRecap.tsx').includes('gasSavings > 0'));
  assert.ok(read('YearRecap.tsx').includes("t('yearReview.screenshot', 'Screenshot to share your year')"));
  assert.ok(read('YearFunFacts.tsx').includes('(comparisons ?? []).filter(Boolean)'));
});
test('read-only original section bytes match their real acquisition hashes (not HEAD)', () => {
  const hashes = {
    YearMonthlyChart: '2137CD04EB7DB5E69273375CED083DDD07CFA950E7BC0BD755DDA7A9276082F8',
    YearChargingBreakdown: '16C038A96DF117423302A2B1D7282AB3F68195B3920FB3C3406A20F43338D8D9',
    YearSavingsPanel: 'EC68EFBEC3FDA9DF8C7B86ABD4CB99C208018F5F22C0597A35176139C2B3DC42',
    YearEnvironmentPanel: 'FD321108C6A9223ADC2E8E81EBF772D7F5BCFB70181B9606D68BF2E729ADAF93',
    YearPatternsPanel: 'CB98EC5E895402A066A7D7C652B81BAD8EB382534BDD91E8D9F25D3D5F7DC2C3',
    YearDriveHighlight: '2C4155D6AC8C7179CAF547990C57B0865BD2DF8A2E8EC08DBFD09CEFB9C91FB6',
    YearExtremes: 'D1039314F18171BE0CFAA735704A7715734C310D843805EF132C8240003C83D7',
    YearComparisons: '7DFFA5F2F4768E084747F52E526177FE731D9111B7D60DDB7AFEC967A66D0E73',
    YearSummaryCard: '019D0AE89F5264060351630573DF175B62F424319CF81888FAB91E603A4999A7',
  };
  for (const [name, hash] of Object.entries(hashes)) {
    const bytes = readFileSync(new URL(`../review/${name}.tsx`, import.meta.url));
    assert.equal(createHash('sha256').update(bytes).digest('hex').toUpperCase(), hash, name);
  }
});
test('owned shipping syntax is clean and contains no raw controls, competing metric or observer framework', () => {
  const files = readdirSync(owned).filter(name => /\.(ts|tsx)$/.test(name) && !name.includes('.test.'));
  for (const [name, source] of [['YearReviewPage.tsx', page], ...files.map(name => [name, read(name)])]) {
    const result = ts.transpileModule(source, { fileName: name, reportDiagnostics: true, compilerOptions: {
      jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022,
    } });
    assert.equal((result.diagnostics ?? []).length, 0, name);
    assert.ok(!/<(?:button|input|textarea|select|table)\b/.test(source), name);
    assert.ok(!/from ['"](?:recharts|react-leaflet|framer-motion)['"]/.test(source), name);
    assert.ok(!/new ResizeObserver|packCardRows|createContext|function formatMetric/.test(source), name);
    assert.ok(!/text-neon-|bg-neon-/.test(source), name);
  }
});
