import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function backendRequired(event, paths) {
  if (event !== 'pull_request') return true;
  // Unknown inputs fail closed. Only exclusively frontend/documentation PRs
  // avoid backend work; renames include both the old and new names.
  return paths.some(path => /\.go$/.test(path) || (!/^(web\/|docs\/|scripts\/screenshots\.js$|Dockerfile\.web$|nginx[^/]*\.conf$|\.github\/workflows\/(frontend-quality|perf|docs)\.yml$|\.github\/scripts\/playwright-[^/]+$)/.test(path)
    && !/^[^/]+\.md$/i.test(path)));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const event = process.env.GITHUB_EVENT_NAME;
  let paths = [];
  if (event === 'pull_request') {
    const { pull_request: pr } = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
    const revisions = [pr.base.sha, pr.head.sha];
    assert.ok(revisions.every(sha => /^[0-9a-f]{40}$/.test(sha)), 'Invalid PR revisions');
    execFileSync('git', ['fetch', '--no-tags', '--depth=1', 'origin', ...revisions], { stdio: 'inherit' });
    paths = execFileSync('git', ['diff', '--name-only', '--no-renames', '-z', ...revisions], {
      encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
    }).split('\0').filter(Boolean);
  }
  const backend = backendRequired(event, paths);
  console.log(JSON.stringify({ event, changedPaths: paths.length, backend }));
  appendFileSync(process.env.GITHUB_OUTPUT, `backend=${backend}\n`);
}
