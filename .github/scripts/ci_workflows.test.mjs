import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { assertUnion, balance, familyGroups, inventory, resultInventory, suiteOptions } from './playwright-duration-shards.mjs';
import { backendRequired } from './ci-scope.mjs';
import { requireResults } from './ci-job-results.mjs';
import { summarize } from './ci-perf.mjs';

const require = createRequire(new URL('../../web/package.json', import.meta.url));
const { load } = require('js-yaml');
const workflow = name => load(readFileSync(new URL(`../workflows/${name}`, import.meta.url), 'utf8'));
const ci = workflow('ci.yml');
const browser = workflow('frontend-quality.yml');
const performance = workflow('perf.yml');
const commands = job => job.steps.map(step => step.run ?? '').join('\n');

test('unit shard matrices match strict merge counts and never fail-fast', () => {
  for (const domain of ['backend', 'frontend']) {
    const count = Number(ci.env[`${domain.toUpperCase()}_SHARDS`]);
    const job = ci.jobs[`${domain}-tests`];
    assert.deepEqual(job.strategy.matrix.shard, Array.from({ length: count }, (_, i) => i + 1));
    assert.equal(job.strategy['fail-fast'], false);
    assert.equal(job.needs, domain === 'backend' ? 'changes' : undefined);
    assert.deepEqual(ci.jobs[`${domain}-coverage`].needs, domain === 'backend' ? ['changes', 'backend-tests'] : 'frontend-tests');
    assert.match(commands(ci.jobs[`${domain}-coverage`]), /ci_test_shards\.py merge|check_vitest_blobs\.mjs/);
  }
  assert.ok(ci.jobs['backend-tests'].services.postgres);
  assert.ok(ci.jobs['backend-database'].services.postgres);
  assert.match(commands(ci.jobs['backend-tests']), /go test -race .*covermode=atomic/);
  assert.match(commands(ci.jobs['frontend-tests']), /--maxWorkers=2/);
});

test('existing required summary names and complete dependency gates remain strict after report merging', () => {
  for (const [jobs, id, name, dependencies] of [
    [ci.jobs, 'backend', 'Backend (lint + test + build)',
      ['changes', 'backend-checks', 'backend-tests', 'backend-coverage', 'backend-database', 'backend-build']],
    [ci.jobs, 'frontend', 'Frontend (lint + test + build)',
      ['frontend-checks', 'frontend-tests', 'frontend-coverage']],
    [ci.jobs, 'ci-gate', 'CI (all checks)',
      ['changes', 'workflow-lint', 'generated', 'backend', 'frontend', 'docs', 'docker']],
    [browser.jobs, 'chromium-quality', 'Chromium responsive, a11y, keyboard, and performance',
      ['contract', 'browser-build', 'chromium-tests']],
    [browser.jobs, 'visual', 'Deliberate visual snapshot gate (Windows baseline)',
      ['contract', 'browser-build', 'visual-tests']],
    [browser.jobs, 'cross-browser', '${{ matrix.browser }} critical smoke',
      ['contract', 'browser-build', 'cross-browser-tests', 'app-design-tests']],
  ]) {
    const job = jobs[id];
    assert.equal(job.name, name);
    assert.equal(job.if, 'always()');
    assert.deepEqual(job.needs, dependencies);
    const gate = job.steps.find(step => /all\(job\["result"\] == "success" for job in results\.values\(\)\)|ci-job-results\.mjs/.test(step.run ?? ''));
    assert.ok(gate, `${id}: missing strict result gate`);
    assert.equal(gate.env.RESULTS, '${{ toJSON(needs) }}');
    if (jobs === browser.jobs) assert.equal(gate.if, 'always()');
  }
});

test('cheap validations and unit tests start independently of the shared browser build', () => {
  for (const id of ['workflow-lint', 'generated', 'frontend-checks', 'frontend-tests', 'docs']) {
    assert.equal(ci.jobs[id].needs, undefined);
  }
  assert.equal(browser.jobs.contract.needs, undefined);
  assert.equal(browser.jobs['browser-build'].needs, undefined);
  assert.equal(ci.jobs.docker.if, undefined);
  const build = ci.jobs.docker.steps.find(step => step.uses?.startsWith('docker/build-push-action'));
  assert.equal(build.with.push, false);
  for (const config of [ci, browser, performance]) {
    assert.equal(config.concurrency['cancel-in-progress'], "${{ github.event_name == 'pull_request' }}");
    for (const job of Object.values(config.jobs)) {
      if (job.strategy) assert.equal(job.strategy['fail-fast'], false);
    }
  }
});

test('node_modules caches require exact OS, architecture, resolved Node and lockfile keys, without fallbacks', () => {
  for (const config of [ci, browser, performance]) {
    for (const [id, job] of Object.entries(config.jobs)) {
      const installs = job.steps.filter(step => step.run?.includes('npm ci --legacy-peer-deps'));
      if (!installs.length) continue;
      const cache = job.steps.find(step => step.id === 'dependencies');
      assert.match(cache.uses, /^actions\/cache@/);
      assert.equal(cache.with['restore-keys'], undefined);
      for (const token of ['${{ runner.os }}', '${{ runner.arch }}', '${{ steps.node.outputs.node-version }}', 'hashFiles(']) {
        assert.ok(cache.with.key.includes(token), `${id}: missing ${token}`);
      }
      assert.ok(cache.with.key.includes(job.container ? '-pw163-noble-' : '-host-'));
      assert.equal(cache.with.path, id === 'docs' ? 'docs/node_modules' : 'web/node_modules');
      assert.ok(cache.with.key.includes(id === 'docs' ? 'docs/package-lock.json' : 'web/package-lock.json'));
      for (const install of installs) assert.equal(install.if, "steps.dependencies.outputs.cache-hit != 'true'");
      assert.equal(job.steps.find(step => step.id === 'node').with['node-version'], '26');
    }
  }
});

test('browser caches use actual Playwright versions and Edge caches its real system executable', () => {
  for (const id of ['contract', 'visual-tests']) {
    const job = browser.jobs[id];
    const cache = job.steps.find(step => step.id === 'browsers');
    assert.ok(cache.with.key.includes('${{ steps.playwright.outputs.version }}'));
    assert.ok(cache.with.key.includes('${{ runner.os }}-${{ runner.arch }}'));
    assert.equal(cache.with['restore-keys'], undefined);
    assert.equal(cache.with.path, '${{ env.PLAYWRIGHT_BROWSERS_PATH }}');
    assert.match(job.steps.find(step => step.id === 'playwright').run, /require\('@playwright\/test\/package.json'\)\.version/);
    assert.equal(job.steps.find(step => step.run === 'npx playwright install chromium').if, "steps.browsers.outputs.cache-hit != 'true'");
  }
  assert.match(commands(browser.jobs.contract), /npx playwright install-deps chromium/);
  const edge = browser.jobs['cross-browser-tests'];
  assert.equal(edge.steps.find(step => step.id === 'edge').with.path, '/opt/microsoft/msedge');
  assert.ok(edge.steps.find(step => step.id === 'edge').with.key.includes('${{ steps.playwright.outputs.version }}'));
  assert.equal(edge.steps.find(step => step.run === 'npx playwright install msedge').if,
    "matrix.browser == 'edge' && steps.edge.outputs.cache-hit != 'true'");
  assert.match(commands(edge), /test -x \/opt\/microsoft\/msedge\/msedge/);
  assert.match(commands(edge), /ln -sf .*\/usr\/bin\/microsoft-edge/);
  for (const job of Object.values(browser.jobs).filter(job => job.container)) {
    assert.doesNotMatch(commands(job), /playwright install (chromium|firefox|webkit)/);
    assert.equal(job.env?.PLAYWRIGHT_BROWSERS_PATH, undefined);
  }
});

test('20 Chromium runners mix heavy and ordinary cases with isolated single-worker cheap suites', () => {
  const rows = browser.jobs['chromium-tests'].strategy.matrix.include;
  assert.deepEqual(rows.map(row => row.name), Array.from({ length: 20 }, (_, i) => `responsive-${i + 1}`));
  assert.deepEqual(rows.map(row => row.shard), Array.from({ length: 20 }, (_, i) => `${i + 1}/20`));
  assert.deepEqual(familyGroups('chromium'), [['quality', 20], ['a11y', 1], ['performance', 1]]);
  assert.deepEqual(rows.filter(row => row.extra).map(row => row.extra), ['a11y', 'performance']);
  assert.equal(suiteOptions('quality').workers, 4);
  for (const suite of ['a11y', 'performance']) assert.equal(suiteOptions(suite).workers, 1);
  const extra = browser.jobs['chromium-tests'].steps.find(step => step.run?.includes('--suite=${{ matrix.extra }}'));
  assert.equal(extra.if, "always() && matrix.extra != ''");
  assert.match(extra.run, /--out=ci-evidence\//);
  assert.deepEqual(browser.jobs['cross-browser-tests'].strategy.matrix, { browser: ['firefox', 'webkit', 'edge'] });
  assert.deepEqual(browser.jobs['visual-tests'].strategy.matrix.shard, [1, 2, 3, 4]);
  assert.equal(browser.jobs['visual-tests']['runs-on'], 'windows-latest');
  assert.equal(Object.values(browser.jobs).filter(job => commands(job).includes('npm run e2e:build')).length, 1);
  for (const id of ['chromium-tests', 'visual-tests', 'cross-browser-tests', 'app-design-tests']) {
    const job = browser.jobs[id];
    assert.equal(job.needs, 'browser-build');
    assert.ok(job.steps.some(step => step.with?.name === 'e2e-app' && step.uses?.startsWith('actions/download-artifact')));
    const run = job.steps.find(step => step.run?.includes('playwright-duration-shards.mjs run'));
    assert.ok(run);
    assert.equal(run.env?.E2E_REUSE_BUILD ?? job.env?.E2E_REUSE_BUILD, '1');
    assert.equal(run.env?.E2E_MOCKS ?? job.env?.E2E_MOCKS, '1');
    assert.equal(job.steps.find(step => step.with?.path === 'web/ci-evidence/').if, 'always()');
    assert.equal(job.steps.find(step => step.name === 'Upload heavy failure evidence').if, 'failure()');
  }
  assert.equal(rows.length + 3 + 4, 27);
});

test('full engine/width/theme profiles and replay have exact partitions with unchanged capacity workers', () => {
  const job = browser.jobs['app-design-tests'];
  assert.equal(job.strategy.matrix.include.length, 24);
  for (const engine of ['firefox', 'webkit']) {
    for (const width of [1440, 390]) {
      for (const theme of ['dark', 'light', 'custom']) {
        const count = engine === 'webkit' ? width === 1440 ? 4 : 2 : 1;
        const rows = job.strategy.matrix.include.filter(row => row.browser === engine && row.width === width && row.theme === theme);
        assert.deepEqual(rows.map(row => row.shard), Array.from({ length: count }, (_, i) => `${i + 1}/${count}`));
        assert.equal(suiteOptions('profile', engine, width, theme).workers, engine === 'webkit' ? width === 1440 ? 1 : 2 : 4);
        assert.ok(familyGroups(engine).some(([group, n]) => group === `profile-${engine}-${width}-${theme}` && n === count));
      }
    }
    assert.ok(familyGroups(engine).some(([group, count]) => group === `replay-${engine}` && count === 1));
  }
  assert.equal(job.env.APP_DESIGN_WORKERS, "${{ matrix.browser == 'webkit' && (matrix.width == 1440 && '1' || '2') || '4' }}");
  assert.equal(job.env.HOME, '/root');
  assert.equal(job.env.E2E_APP_DESIGN_CROSS_BROWSER, '1');
  const replay = job.steps.find(step => step.name === 'Preserve engine replay contract');
  assert.equal(replay.if, "always() && matrix.width == 1440 && matrix.theme == 'dark' && (matrix.shard == '1/1' || matrix.shard == '1/4')");
  assert.match(replay.run, /--suite=replay.*--out=ci-evidence\/replay/);
  const envelope = job.steps.find(step => step.name === 'Bind application design evidence to its source and build');
  assert.match(envelope.run, /indexSHA256: hash\('e2e\/\.app-dist\/index\.html'\)/);
  assert.match(envelope.run, /acceptanceSourceSHA256: hash\('e2e\/widget-design-packs\.app\.spec\.ts'\)/);
});

test('application profiles run before merge, nightly and manually, never on a PR or main push', () => {
  const events = 'contains(fromJSON(\'["merge_group","schedule","workflow_dispatch"]\'), github.event_name)';
  assert.equal(browser.jobs['app-design-tests'].if, events);
  assert.equal(browser.env.APP_DESIGNS, `\${{ ${events} }}`);
  assert.ok(browser.on.schedule[0].cron);
  assert.equal(browser.on.pull_request.paths, undefined, 'Required browser summaries must report on every PR');
  for (const config of [ci, browser, workflow('security.yml')]) {
    assert.deepEqual(config.on.merge_group, { types: ['checks_requested'] });
  }
  const summary = browser.jobs['cross-browser'];
  assert.ok(commands(summary).includes('--profiles=${{ env.APP_DESIGNS }}'));
  const gate = summary.steps.find(step => step.run?.includes('ci-job-results.mjs'));
  assert.equal(gate.env.SKIPPED_JOBS, "${{ env.APP_DESIGNS != 'true' && 'app-design-tests' || '' }}");
  for (const family of ['firefox', 'webkit']) {
    assert.deepEqual(familyGroups(family, false), [[`engine-${family}`, 1]]);
    assert.equal(familyGroups(family, true).length, 8);
  }
});

test('backend paths fail closed and only PRs may avoid backend execution', () => {
  for (const path of ['internal/app/new.go', 'cmd/main.go', 'pkg/shared.go', 'go.mod', 'go.sum',
    'migrations/001.sql', 'helm/teslasync/values.yaml', 'Dockerfile', 'Dockerfile.notification',
    'Dockerfile.export-worker', 'Dockerfile.fleet-telemetry', 'docker-compose.yml', '.dockerignore',
    '.golangci.yml', 'Makefile', 'scripts/check.sh', '.github/workflows/ci.yml',
    '.github/scripts/ci-scope.mjs', 'unknown/new-input', 'docs/example.go']) {
    assert.equal(backendRequired('pull_request', [path]), true, path);
  }
  const frontend = ['web/src/App.tsx', 'web/package-lock.json', 'docs/ci/CI-PERF.md', 'README.md',
    'Dockerfile.web', '.github/workflows/frontend-quality.yml', '.github/scripts/playwright-test-durations.json'];
  assert.equal(backendRequired('pull_request', frontend), false);
  assert.equal(backendRequired('pull_request', [...frontend, 'internal/deleted.go']), true);
  for (const event of ['push', 'merge_group', 'workflow_dispatch', 'schedule']) {
    assert.equal(backendRequired(event, frontend), true);
    assert.equal(backendRequired(event, []), true);
  }
  for (const id of ['backend-checks', 'backend-tests', 'backend-build', 'backend-database']) {
    assert.equal(ci.jobs[id].needs, 'changes');
    assert.equal(ci.jobs[id].if, "needs.changes.outputs.backend == 'true'");
  }
  assert.equal(ci.jobs['backend-coverage'].if, "always() && needs.changes.outputs.backend == 'true'");
  assert.equal(ci.jobs.docker.needs, 'changes');
  assert.equal(ci.jobs.docker.steps.find(step => step.uses?.startsWith('docker/build-push-action')).if,
    "matrix.image == 'web' || needs.changes.outputs.backend == 'true'");
  assert.equal(ci.jobs.backend.steps.find(step => step.run?.includes('ci-job-results.mjs')).env.SKIPPED_JOBS,
    "${{ needs.changes.outputs.backend == 'false' && 'backend-checks,backend-tests,backend-coverage,backend-database,backend-build' || '' }}");
});

test('summaries accept only explicit skips and reject failures, cancellations, unexpected skips and failed scope', () => {
  const good = { changes: { result: 'success' }, backend: { result: 'success' } };
  requireResults(good);
  requireResults({ ...good, backend: { result: 'skipped' } }, ['backend']);
  for (const result of ['failure', 'cancelled', 'skipped']) {
    assert.throws(() => requireResults({ ...good, backend: { result } }));
  }
  for (const result of ['success', 'failure', 'cancelled']) {
    assert.throws(() => requireResults({ ...good, backend: { result } }, ['backend']));
  }
  assert.throws(() => requireResults({ changes: { result: 'failure' }, backend: { result: 'skipped' } }, ['backend']));
  assert.throws(() => requireResults(good, ['unknown']));
  assert.throws(() => requireResults({}));
});

test('timings use ready-job creation for queue, exclude skipped jobs and reject unfinished runs', () => {
  const run = { id: 1, status: 'completed', created_at: '2026-11-17T00:00:00Z' };
  const job = {
    id: 2, name: 'Chromium', status: 'completed', conclusion: 'success',
    created_at: '2026-11-17T00:03:00Z', started_at: '2026-11-17T00:05:00Z', completed_at: '2026-11-17T00:10:00Z',
    steps: [
      { name: 'Run actions/checkout@v7', started_at: '2026-11-17T00:05:00Z', completed_at: '2026-11-17T00:06:00Z' },
      { name: 'Run isolated Chromium suite', started_at: '2026-11-17T00:06:00Z', completed_at: '2026-11-17T00:09:00Z' },
    ],
  };
  const summary = summarize(run, [job, { ...job, conclusion: 'skipped' }]);
  assert.equal(summary.jobs, 1);
  assert.equal(summary.skipped, 1);
  assert.equal(summary.wall, 10);
  assert.equal(summary.queue, 2);
  assert.equal(summary.runner, 5);
  assert.equal(summary.setup, 1);
  assert.equal(summary.execution, 3);
  assert.equal(summary.other, 1);
  assert.throws(() => summarize({ ...run, status: 'in_progress' }, [job]));
});

test('summary jobs require every suite blob merge and publish combined failure HTML only on failure', () => {
  const contract = browser.jobs.contract;
  assert.match(commands(contract), /npm run e2e:contract -- --reporter=line,json/);
  assert.match(commands(contract), /npm run e2e:list -- --reporter=line/);
  const contractReport = contract.steps.find(step => step.name === 'Upload contract JSON');
  assert.equal(contractReport.if, 'always()');
  assert.equal(contractReport.with.path, 'web/ci-contract/results.json');
  assert.equal(contractReport.with['if-no-files-found'], 'error');
  for (const id of ['chromium-quality', 'cross-browser', 'visual']) {
    const job = browser.jobs[id];
    assert.match(commands(job), /playwright-duration-shards\.mjs merge --family=/);
    assert.equal(job.steps.find(step => step.name === 'Upload merged suite JSON').if, 'always()');
    assert.equal(job.steps.find(step => step.name === 'Upload combined failure HTML').if,
      "failure() || contains(needs.*.result, 'failure') || contains(needs.*.result, 'cancelled')");
    assert.equal(job.steps.find(step => step.name === 'Upload merged suite JSON').with['if-no-files-found'], 'error');
  }
  const helper = readFileSync(new URL('./playwright-duration-shards.mjs', import.meta.url), 'utf8');
  assert.match(helper, /--reporter=line,json,blob/);
  assert.match(helper, /merge-reports', '--reporter=json,github'/);
  assert.match(helper, /merge-reports', '--reporter=html'/);
  assert.match(helper, /report\.stats\.unexpected \|\| report\.errors\.length \|\| process\.env\.REPORT_FAILURE/);
  assert.match(helper, /Number\(width\) === 1440 \? 23 : 21/);
  assert.match(helper, /throw new AggregateError\(errors/);
  assert.match(helper, /await compactBlob\(join\(out, 'blob'/);
  assert.match(helper, /test\.expectedStatus === 'passed' && result\.status === 'passed' && !result\.errors\.length/);
  assert.match(helper, /eligible\.get\(test\.testId\) \?\? true/);
});

test('duration balancing uses every full test identity once and rejects missing or duplicated cases', () => {
  const cases = ['Native record-states real routes at 1440px in dark', 'short a', 'short b', 'short c']
    .map((title, i) => ({ project: 'chromium-smoke', file: 'sample.spec.ts', path: [], title, key: String(i) }));
  const shards = balance(cases, 2);
  assert.equal(shards[0].tests[0].title, cases[0].title);
  assert.equal(shards[0].tests.length, 1);
  assertUnion(cases, shards.flatMap(shard => shard.tests));
  assert.throws(() => assertUnion(cases, [...cases.slice(1), cases[1]]), /multiset union/);
  assert.throws(() => balance(cases, 5), /shard count/);
  assert.throws(() => balance(cases, 2, 0), /worker count/);
  const workerShards = balance(cases, 2, 2);
  assertUnion(cases, workerShards.flatMap(shard => shard.tests));
  assert.ok(workerShards.every(shard => shard.projectedSeconds <= shard.seconds));
  const report = { suites: [{ title: 'sample.spec.ts', file: 'sample.spec.ts', suites: ['phone', 'desktop'].map(title => ({
    title, specs: [{ file: 'sample.spec.ts', title: 'same leaf', tests: [{ projectName: 'chromium-smoke' }] }],
  })) }] };
  assert.equal(new Set(inventory(report).map(item => item.key)).size, 2);
  assert.throws(() => resultInventory(report), /Missing actual test outcomes/);
  for (const suite of report.suites[0].suites) suite.specs[0].tests[0].results = [{ status: 'passed' }];
  assertUnion(inventory(report), resultInventory(report));
  report.suites[0].suites[0].specs[0].tests[0].results = [{}];
  assert.throws(() => resultInventory(report), /Invalid actual test outcome/);
  const helper = readFileSync(new URL('./playwright-duration-shards.mjs', import.meta.url), 'utf8');
  assert.match(helper, /const measured = measuredDurations\.durations\[test\.key\]/);
  assert.match(helper, /unmeasured: full\.filter\(test => !Object\.hasOwn\(measuredDurations\.durations, test\.key\)\)/);
});

test('parallelization introduces no additional nonblocking test exceptions', () => {
  const waivers = Object.entries(ci.jobs).flatMap(([job, config]) =>
    config.steps.filter(step => step['continue-on-error']).map(step => [job, step.name]));
  assert.deepEqual(waivers, [['backend-database', 'Integration test (telemetry replay)']]);
});
