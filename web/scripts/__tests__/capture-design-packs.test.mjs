import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const script = fileURLToPath(new URL('../capture-design-packs.mjs', import.meta.url));
const webRoot = fileURLToPath(new URL('../../', import.meta.url));
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

test('capture output stays outside Vite and cleans only its own directory after failure', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'teslasync-capture-test-'));
  const server = createServer((_, response) => { response.writeHead(200).end('ok'); });
  try {
    await writeFile(join(scratch, 'keep.txt'), 'keep');
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const args = ['--pack', 'not-a-pack', '--pages', 'dashboard', '--viewports', 'phone-390',
      '--base-url', `http://127.0.0.1:${address.port}`];
    const runWithRoot = outputRoot => {
      const child = spawn(process.execPath, [script, ...args], {
        env: { ...process.env, DESIGN_PACK_CAPTURE_OUTPUT_ROOT: outputRoot },
        stdio: 'ignore',
      });
      return new Promise((resolve, reject) => {
        child.once('error', reject);
        child.once('exit', resolve);
      });
    };
    const status = await runWithRoot(scratch);
    assert.equal(status, 1);
    assert.deepEqual(await readdir(scratch), ['keep.txt']);

    const repoRoot = dirname(webRoot);
    const captureDirs = async () => (await readdir(repoRoot))
      .filter(name => name.startsWith('teslasync-design-pack-capture-')).sort();
    const before = await captureDirs();
    assert.equal(await runWithRoot(repoRoot), 1);
    assert.deepEqual(await captureDirs(), before);

    const insideWeb = spawnSync(process.execPath, [script, ...args], {
      encoding: 'utf8', env: { ...process.env, DESIGN_PACK_CAPTURE_OUTPUT_ROOT: webRoot },
    });
    assert.equal(insideWeb.status, 1);
    assert.match(insideWeb.stderr, /outside the web directory/);
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await rm(scratch, { recursive: true, force: true });
  }
});
