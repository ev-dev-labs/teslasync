import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(new URL('../../web/package.json', import.meta.url));
const { load } = require('js-yaml');
const workflow = name => load(readFileSync(new URL(`../workflows/${name}`, import.meta.url), 'utf8'));
const ci = workflow('ci.yml');
const browser = workflow('frontend-quality.yml');
const commands = job => job.steps.map(step => step.run ?? '').join('\n');

test('unit shard matrices match the strict merge counts and never fail-fast', () => {
  for (const domain of ['backend', 'frontend']) {
    const count = Number(ci.env[`${domain.toUpperCase()}_SHARDS`]);
    const job = ci.jobs[`${domain}-tests`];
    assert.deepEqual(job.strategy.matrix.shard, Array.from({ length: count }, (_, i) => i + 1));
    assert.equal(job.strategy['fail-fast'], false);
    assert.equal(job.needs, undefined);
    assert.equal(ci.jobs[`${domain}-coverage`].needs, `${domain}-tests`);
    assert.match(commands(ci.jobs[`${domain}-coverage`]), /ci_test_shards\.py merge|check_vitest_blobs\.mjs/);
  }
  assert.ok(ci.jobs['backend-tests'].services.postgres);
  assert.ok(ci.jobs['backend-database'].services.postgres);
  assert.match(commands(ci.jobs['backend-tests']), /go test -race .*covermode=atomic/);
  assert.match(commands(ci.jobs['frontend-tests']), /--maxWorkers=2/);
});

test('existing aggregate names reject any required job that did not succeed', () => {
  for (const [jobs, id, name, dependencies] of [
    [ci.jobs, 'backend', 'Backend (lint + test + build)',
      ['backend-checks', 'backend-tests', 'backend-coverage', 'backend-database', 'backend-build']],
    [ci.jobs, 'frontend', 'Frontend (lint + test + build)',
      ['frontend-checks', 'frontend-tests', 'frontend-coverage']],
    [ci.jobs, 'ci-gate', 'CI (generated + backend + frontend + Docker)',
      ['generated', 'backend', 'frontend', 'docker']],
    [browser.jobs, 'chromium-quality', 'Chromium responsive, a11y, keyboard, and performance',
      ['contract', 'browser-build', 'chromium-tests']],
    [browser.jobs, 'visual', 'Deliberate visual snapshot gate (Windows baseline)',
      ['contract', 'browser-build', 'visual-tests']],
    [browser.jobs, 'cross-browser', '${{ matrix.browser }} critical smoke',
      ['contract', 'browser-build', 'cross-browser-tests']],
  ]) {
    const job = jobs[id];
    assert.equal(job.name, name);
    assert.equal(job.if, 'always()');
    assert.deepEqual(job.needs, dependencies);
    assert.match(commands(job), /all\(job\["result"\] == "success" for job in results\.values\(\)\)/);
    assert.equal(job.steps[0].env.RESULTS, '${{ toJSON(needs) }}');
  }
});

test('independent validation and Docker builds start together; final gate checks their results', () => {
  for (const id of ['generated', 'backend-checks', 'backend-build', 'backend-database', 'frontend-checks', 'docker']) {
    assert.equal(ci.jobs[id].needs, undefined);
  }
  assert.equal(ci.jobs.docker.if, undefined);
  const build = ci.jobs.docker.steps.find(step => step.uses?.startsWith('docker/build-push-action'));
  assert.equal(build.with.push, false);
});

test('browser shards reuse one build and retain isolated performance and Windows baselines', () => {
  const shards = browser.jobs['chromium-tests'].strategy.matrix.include;
  assert.deepEqual(shards.filter(shard => shard.suite === 'quality').map(shard => shard.shard),
    Array.from({ length: 64 }, (_, i) => `${i + 1}/64`));
  for (const [suite, count] of [['a11y', 13], ['performance', 1]]) {
    assert.deepEqual(shards.filter(shard => shard.suite === suite).map(shard => shard.shard),
      Array.from({ length: count }, (_, i) => `${i + 1}/${count}`));
  }
  assert.deepEqual(browser.jobs['cross-browser-tests'].strategy.matrix,
    { browser: ['firefox', 'webkit'], shard: [1, 2, 3] });
  assert.match(commands(browser.jobs['cross-browser-tests']), /--shard=\$\{\{ matrix\.shard \}\}\/3/);
  assert.match(commands(browser.jobs['visual-tests']), /--shard=\$\{\{ matrix\.shard \}\}\/64 --workers=2/);
  for (const id of ['chromium-tests', 'visual-tests', 'cross-browser-tests']) {
    const job = browser.jobs[id];
    assert.equal(job.needs, 'browser-build');
    assert.equal(job.strategy['fail-fast'], false);
    assert.ok(job.steps.some(step => step.with?.name === 'e2e-app' && step.uses?.startsWith('actions/download-artifact')));
    assert.equal(job.steps.find(step => step.env?.E2E_REUSE_BUILD)?.env.E2E_REUSE_BUILD, '1');
  }
  assert.equal(browser.jobs['visual-tests']['runs-on'], 'windows-latest');
  assert.deepEqual(browser.jobs['visual-tests'].strategy.matrix.shard,
    Array.from({ length: 64 }, (_, i) => i + 1));
  assert.equal(Object.values(browser.jobs).filter(job => commands(job).includes('npm run e2e:build')).length, 1);
});

test('parallelization introduces no additional nonblocking test exceptions', () => {
  const waivers = Object.entries(ci.jobs).flatMap(([job, config]) =>
    config.steps.filter(step => step['continue-on-error']).map(step => [job, step.name]));
  assert.deepEqual(waivers, [['backend-database', 'Integration test (telemetry replay)']]);
});
