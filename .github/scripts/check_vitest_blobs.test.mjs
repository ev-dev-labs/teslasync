import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import { checkBlobs } from './check_vitest_blobs.mjs';

const requireWeb = createRequire(new URL('../../web/package.json', import.meta.url));
const { stringify } = createRequire(requireWeb.resolve('vitest/package.json'))('flatted');
let root;
const blob = (files, coverage = { 'source.ts': {} }, errors = []) =>
  stringify(['4.1.2', files.map(filepath => ({ filepath })), errors, coverage]);

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'vitest-shards-'));
  writeFileSync(join(root, 'blob-1-2.json'), blob(['/a.test.ts']));
  writeFileSync(join(root, 'blob-2-2.json'), blob(['/b.test.ts']));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

test('accepts exact discovery across all shards regardless of order', () => {
  checkBlobs(root, 2, ['/b.test.ts', '/a.test.ts']);
});
test('rejects missing and extraneous artifacts', () => {
  assert.throws(() => checkBlobs(root, 3, []), /artifacts/);
  writeFileSync(join(root, 'extra.json'), blob(['/c.test.ts']));
  assert.throws(() => checkBlobs(root, 2, []), /artifacts/);
});
test('rejects duplicated test files even if the artifact count is correct', () => {
  writeFileSync(join(root, 'blob-2-2.json'), blob(['/a.test.ts']));
  assert.throws(() => checkBlobs(root, 2, ['/a.test.ts', '/b.test.ts']), /duplicated/);
});
test('rejects omitted and unexpected tests', () => {
  for (const expected of [['/a.test.ts'], ['/a.test.ts', '/b.test.ts', '/c.test.ts']]) {
    assert.throws(() => checkBlobs(root, 2, expected), /discovery/);
  }
});
test('rejects empty tests, missing coverage, and unhandled worker errors', () => {
  for (const value of [blob([]), blob(['/b.test.ts'], null), blob(['/b.test.ts'], {}),
    blob(['/b.test.ts'], { 'source.ts': {} }, [{ message: 'worker crashed' }])]) {
    writeFileSync(join(root, 'blob-2-2.json'), value);
    assert.throws(() => checkBlobs(root, 2, ['/a.test.ts', '/b.test.ts']), /missing tests/);
  }
});
test('rejects corrupt reports and invalid shard counts', () => {
  writeFileSync(join(root, 'blob-2-2.json'), '{broken');
  assert.throws(() => checkBlobs(root, 2, []), SyntaxError);
  for (const count of [0, -1, 1.5, NaN]) {
    assert.throws(() => checkBlobs(root, count, []), /count/);
  }
});
