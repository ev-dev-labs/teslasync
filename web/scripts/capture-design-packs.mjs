import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const usage = 'Usage: node scripts/capture-design-packs.mjs --pack <id> '
  + '--pages <dashboard,drives,energy|all> --viewports <phone-390,desktop> '
  + '--base-url <running local server URL>';

async function main() {
  const { values } = parseArgs({
    options: {
      pack: { type: 'string' },
      pages: { type: 'string' },
      viewports: { type: 'string' },
      'base-url': { type: 'string' },
      help: { type: 'boolean' },
    },
  });
  if (values.help) {
    console.log(usage);
    return;
  }
  const { pack, pages, viewports } = values;
  const baseURL = values['base-url'] ?? process.env.DESIGN_PACK_CAPTURE_BASE_URL;
  if (!pack || !pages || !viewports || !baseURL) throw new Error(usage);
  if (!/^[a-z0-9-]+$/.test(pack)) throw new Error('Invalid pack ID');
  const projects = viewports.split(',').map(value => value.trim());
  if (projects.some(value => !/^[a-z0-9-]+$/.test(value)) || new Set(projects).size !== projects.length) {
    throw new Error('Viewports must be comma-separated Playwright project names');
  }
  const server = new URL(baseURL);
  if (!['http:', 'https:'].includes(server.protocol)
    || !['localhost', '127.0.0.1', '[::1]'].includes(server.hostname)
    || server.username || server.password || server.pathname !== '/' || server.search || server.hash) {
    throw new Error('The capture server must be a local HTTP(S) origin');
  }
  const response = await fetch(server.origin, { redirect: 'error', signal: AbortSignal.timeout(5_000) });
  if (!response.ok) throw new Error(`Capture server returned HTTP ${response.status}`);

  const args = [
    join(root, 'node_modules', '@playwright', 'test', 'cli.js'),
    'test', '--config=e2e/design-packs-capture.config.ts', '--workers=1',
    '--grep=capture ',
    ...projects.map(project => `--project=${project}`),
  ];
  const outputDir = await mkdtemp(join(tmpdir(), 'teslasync-design-pack-capture-'));
  try {
    const child = spawn(process.execPath, args, {
      cwd: root,
      env: {
        ...process.env,
        DESIGN_PACK: pack,
        DESIGN_PACK_PAGES: pages === 'all' ? '' : pages,
        DESIGN_PACK_CAPTURE_BASE_URL: server.origin,
        DESIGN_PACK_CAPTURE_OUTPUT_DIR: outputDir,
        DESIGN_PACK_CAPTURE_STATES: '0',
        DESIGN_PACK_CHECK_TOUCH: '1',
        DESIGN_PACK_CHECK_TEXT_SIZE: '1',
        DESIGN_PACK_VIEWPORT_ONLY: '1',
      },
      stdio: 'inherit',
    });
    process.exitCode = await new Promise((resolveExit, reject) => {
      child.once('error', reject);
      child.once('exit', (code, signal) => resolveExit(code ?? (signal ? 1 : 0)));
    });
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
