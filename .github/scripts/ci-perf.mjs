import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const minutes = (start, end) => Math.max(0, (Date.parse(end) - Date.parse(start)) / 60000);
const execution = /test|suite|shard|gate|lint|build|check|freshness|validate|validation|compare|require complete|replay|registry|scenario|merge|coverage|receipt|envelope|bind application|record application/i;
const setup = /^(set up job|initialize containers|run actions\/|run docker\/|run azure\/|run npm ci|install |resolve exact|cache |verify cached|post |complete job|stop containers|upload |download )/i;
const round = value => Number(value.toFixed(2));

export function summarize(run, jobs) {
  assert.equal(run.status, 'completed', `Run ${run.id} is still in progress`);
  const rows = jobs.filter(job => job.conclusion !== 'skipped').map(job => {
    assert.equal(job.status, 'completed', `${job.name} is incomplete`);
    const steps = job.steps.filter(step => step.started_at && step.completed_at && step.conclusion !== 'skipped');
    let setupMinutes = 0;
    let executionMinutes = 0;
    for (const step of steps) {
      const elapsed = minutes(step.started_at, step.completed_at);
      if (setup.test(step.name)) setupMinutes += elapsed;
      else if (execution.test(step.name)) executionMinutes += elapsed;
    }
    const runner = minutes(job.started_at, job.completed_at);
    return {
      run: run.id, id: job.id, job: job.name, conclusion: job.conclusion,
      queue: minutes(job.created_at, job.started_at), runner, setup: setupMinutes,
      execution: executionMinutes, other: Math.max(0, runner - setupMinutes - executionMinutes),
    };
  });
  assert.ok(rows.length, 'No executed jobs');
  const total = field => rows.reduce((sum, row) => sum + row[field], 0);
  return {
    run: run.id, workflow: run.name, conclusion: run.conclusion, sha: run.head_sha,
    event: run.event, url: run.html_url, jobs: rows.length, skipped: jobs.length - rows.length,
    wall: minutes(run.created_at, new Date(Math.max(...jobs.map(job => Date.parse(job.completed_at) || 0))).toISOString()),
    runner: total('runner'), queue: total('queue'), maxQueue: Math.max(...rows.map(row => row.queue)),
    setup: total('setup'), execution: total('execution'), other: total('other'), rows,
  };
}

function collect(id) {
  assert.match(id, /^\d+$/);
  const api = path => JSON.parse(execFileSync('gh', ['api', `repos/ev-dev-labs/teslasync/${path}`], {
    encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
  }));
  const run = api(`actions/runs/${id}`);
  const jobs = [];
  for (let page = 1; ; page++) {
    const batch = api(`actions/runs/${id}/attempts/${run.run_attempt}/jobs?per_page=100&page=${page}`);
    jobs.push(...batch.jobs);
    if (jobs.length >= batch.total_count) break;
  }
  return { run, jobs, summary: summarize(run, jobs) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [out, ...ids] = process.argv.slice(2);
  assert.ok(out && ids.length, 'Usage: node ci-perf.mjs OUTPUT_DIRECTORY RUN_ID ...');
  mkdirSync(out, { recursive: true });
  const summaries = ids.map(id => {
    const evidence = collect(id);
    writeFileSync(join(out, `run-${id}.json`), JSON.stringify(evidence, null, 2) + '\n');
    return evidence.summary;
  });
  const table = [
    '| Run | Workflow | Result | Jobs (+ skipped) | Wall min | Runner min | Queue sum min | Queue max min | Setup min | Execution min | Other min |',
    '| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...summaries.map(s => `| [${s.run}](${s.url}) | ${s.workflow} | ${s.conclusion} | ${s.jobs} (+${s.skipped}) | ${[s.wall, s.runner, s.queue, s.maxQueue, s.setup, s.execution, s.other].map(round).join(' | ')} |`),
  ].join('\n') + '\n';
  writeFileSync(join(out, 'summary.md'), table);
  const fields = ['run', 'id', 'job', 'conclusion', 'queue', 'runner', 'setup', 'execution', 'other'];
  const csv = [fields.join(','), ...summaries.flatMap(s => s.rows.map(row => fields.map(field =>
    typeof row[field] === 'number' ? round(row[field]) : `"${row[field].replaceAll('"', '""')}"`).join(',')))].join('\n') + '\n';
  writeFileSync(join(out, 'jobs.csv'), csv);
  console.log(table);
}
