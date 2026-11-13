import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const script = fileURLToPath(new URL('../capture-design-packs.mjs', import.meta.url));
const run = (...args) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });

test('capture runner requires a pack, page list, viewport list and server', () => {
  const result = run('--pack', 'classic');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Usage:/);
});

test('capture runner rejects non-local servers and malformed projects before connecting', () => {
  const common = ['--pack', 'classic', '--pages', 'dashboard', '--viewports', 'phone-390'];
  const remote = run(...common, '--base-url', 'https://example.invalid');
  assert.equal(remote.status, 1);
  assert.match(remote.stderr, /local HTTP/);

  const project = run('--pack', 'classic', '--pages', 'dashboard',
    '--viewports', '../desktop', '--base-url', 'http://127.0.0.1:49873');
  assert.equal(project.status, 1);
  assert.match(project.stderr, /Playwright project names/);
});

test('capture configuration never manages the server lifecycle', async () => {
  const config = await readFile(new URL('../../e2e/design-packs-capture.config.ts', import.meta.url), 'utf8');
  assert.match(config, /DESIGN_PACK_CAPTURE_BASE_URL/);
  assert.doesNotMatch(config, /\bwebServer\s*:/);
});
