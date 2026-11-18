import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function requireResults(results, skipped = []) {
  assert.ok(Object.keys(results).length, 'Missing dependency results');
  for (const id of skipped) assert.ok(Object.hasOwn(results, id), `Unknown skipped dependency: ${id}`);
  for (const [id, job] of Object.entries(results)) {
    assert.equal(job.result, skipped.includes(id) ? 'skipped' : 'success', `${id}: unexpected dependency result`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const results = JSON.parse(process.env.RESULTS);
  const skipped = process.env.SKIPPED_JOBS?.split(',').filter(Boolean) ?? [];
  console.log(JSON.stringify({ results, skipped }));
  requireResults(results, skipped);
}
