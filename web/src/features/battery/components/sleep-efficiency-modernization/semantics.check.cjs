/* Scoped Node/pure checks only. Transpilation is not TypeScript type checking. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '../../../../../..');

function pureModule(rel) {
  const exports = {};
  const text = fs.readFileSync(path.join(root, rel), 'utf8');
  const js = ts.transpileModule(text, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  vm.runInNewContext(js, { exports, require: name => { throw new Error(`Unexpected pure dependency: ${name}`); } });
  return exports;
}
const { deriveDataState } = pureModule('web/src/api/dataState.ts');
const { analyzeSleepEfficiency, analyzeSleepRange } = pureModule('web/src/features/battery/lib/sleepEfficiencyAnalysis.ts');
const { sleepEfficiencyFixture } = pureModule('web/src/features/battery/components/sleep-efficiency-modernization/sleepEfficiency.fixture.ts');
let checks = 0;
function check(name, run) {
  run();
  checks++;
  console.log(`PASS ${name}`);
}
const now = Date.parse('2026-08-07T12:00:00Z');
const data = sleepEfficiencyFixture();
const readAnalysis = payload => analyzeSleepEfficiency(payload, now, '2026-08-04', '2026-08-06');
check('initial pending has no retained bytes and no fatal error', () => {
  const state = deriveDataState({ isPending: true, fetchStatus: 'fetching' });
  assert.equal(state.hasData, false);
  assert.equal(state.status, 'initial');
  assert.equal(state.fatalError, null);
});
check('initial paused remains unknown, not a loaded empty response', () => {
  const state = deriveDataState({ isPending: true, fetchStatus: 'paused' });
  assert.equal(state.isRefreshBlocked, true);
  assert.equal(state.status, 'initial');
  assert.equal(state.provenance, 'unknown');
  assert.equal(state.hasData, false);
});
check('retained refresh failure keeps exact data identity and affected-source retry', () => {
  let retries = 0;
  const error = 'transport failure';
  const state = deriveDataState({ data, error, refetch: () => { retries++; } }, { provenance: 'historical' });
  assert.equal(state.data, data);
  assert.equal(state.fatalError, null);
  assert.equal(state.refreshError.message, error);
  assert.equal(state.status, 'stale');
  assert.equal(state.provenance, 'historical');
  state.retry();
  assert.equal(retries, 1);
});
check('retained paused source keeps exact data without a fabricated failure', () => {
  const state = deriveDataState({ data, fetchStatus: 'paused' }, { provenance: 'historical' });
  assert.equal(state.data, data);
  assert.equal(state.status, 'stale');
  assert.equal(state.isRefreshBlocked, true);
  assert.equal(state.refreshError, null);
});
check('initial error alone is fatal', () => {
  const state = deriveDataState({ error: 'not measured', isError: true });
  assert.equal(state.status, 'initialFailure');
  assert.equal(state.fatalError.message, 'not measured');
  assert.equal(state.refreshError, null);
});
check('inclusive UTC range/default analysis semantics remain independent of presentation', () => {
  assert.equal(analyzeSleepRange('2026-08-04', '2026-08-06').inclusiveDays, 3);
  assert.equal(analyzeSleepRange('2026-08-06', '2026-08-06').inclusiveDays, 1);
  assert.equal(analyzeSleepRange('2026-08-06', '2026-08-04').inclusiveDays, null);
});
check('transition counts never synthesize dwell or duration efficiency from placeholder zero', () => {
  const analysis = readAnalysis(data);
  assert.equal(analysis.transitions.totalCount, 11);
  assert.equal(analysis.transitions.asleepCount, 8);
  assert.equal(analysis.dwell.available, false);
  assert.equal(analysis.dwell.recomputedEfficiencyPct, null);
  assert.equal(analysis.dwell.timeToSleepAvgMin, null);
  assert.equal(analysis.sentry.comparisonAvailable, false);
});
check('missing response stays unmeasured; the existing empty sum is guarded from display', () => {
  const analysis = readAnalysis(undefined);
  assert.equal(analysis.source.hasResponse, false);
  assert.equal(analysis.events.aggregates.available, false);
  // Baseline safeSum([]) is 0 internally. Its availability gate, not a changed
  // calculation, prevents rendering that empty sum as measured zero drain.
  assert.equal(analysis.events.aggregates.totalBatteryLost, 0);
  assert.equal(analysis.events.aggregates.medianDrainRate, null);
  const profile = fs.readFileSync(path.join(root,
    'web/src/features/battery/components/sleep-efficiency/DrainEventProfile.tsx'), 'utf8');
  assert.ok(profile.includes('{aggregates.available ? ('));
  assert.ok(profile.includes('Drain-event aggregates unavailable'));
  assert.equal(analysis.dwell.recomputedEfficiencyPct, null);
});
check('event validation, first-valid deduplication, future exclusions and SI temperature survive', () => {
  const event = data.recent_events[0];
  const payload = { ...data, recent_events: [
    event,
    { ...event },
    { ...event, id: 11, start_date: 'bad timestamp' },
    { ...event, id: 12, start_date: '2026-08-08T01:00:00Z', end_date: '2026-08-08T05:00:00Z' },
    { ...event, id: 13, duration_hours: -1 },
  ] };
  const analysis = readAnalysis(payload);
  assert.equal(analysis.events.directory.length, 1);
  assert.equal(analysis.events.directory[0].outsideTempC, 20);
  assert.equal(analysis.events.accounting.categories.duplicate_id, 1);
  assert.equal(analysis.events.accounting.categories.invalid_timestamp, 1);
  assert.equal(analysis.events.accounting.categories.future, 1);
  assert.equal(analysis.events.accounting.categories.invalid_duration, 1);
  assert.equal(analysis.events.accounting.excludedRows, 4);
  assert.equal(analysis.source.frozenNowMs, now);
});
console.log(JSON.stringify({ status: 'PASS_PURE_ONLY', checks, runtime: 'NOTRUN', typescriptProgram: 'NOTRUN' }));
