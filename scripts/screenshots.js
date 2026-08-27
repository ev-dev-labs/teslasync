const { spawnSync } = require('node:child_process');
const { resolve } = require('node:path');

const webRoot = resolve(__dirname, '..', 'web');
const args = ['run', 'screenshots:docs', '--', ...process.argv.slice(2)];
const npmCli = process.env.npm_execpath;
const result = npmCli
  ? spawnSync(process.execPath, [npmCli, ...args], {
      cwd: webRoot,
      env: process.env,
      stdio: 'inherit',
    })
  : spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, {
  cwd: webRoot,
  env: process.env,
  stdio: 'inherit',
      shell: process.platform === 'win32',
    });

if (result.error) {
  console.error(`Unable to start the Playwright visual suite: ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
