#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const targetScript = process.argv[2];
const forwardedArgs = process.argv.slice(3);
if (!targetScript) {
  console.error('Usage: node scripts/run-e2e-suite.mjs <npm-script> [playwright args...]');
  process.exit(2);
}

const npmCli = process.env.npm_execpath;
if (!npmCli) {
  console.error('npm_execpath is unavailable; invoke this wrapper through npm run.');
  process.exit(2);
}

const runNpm = (args, options = {}) =>
  spawnSync(process.execPath, [npmCli, ...args], {
    cwd: process.cwd(),
    env: { ...process.env, ...options.env },
    stdio: 'inherit',
  });

if (process.env.E2E_BASE_URL) {
  const result = runNpm(['run', targetScript, '--', ...forwardedArgs], {
    env: { E2E_SKIP_WEBSERVER: '1' },
  });
  process.exit(result.status ?? 1);
}

if (process.env.E2E_REUSE_BUILD !== '1') {
  const build = runNpm(['run', 'e2e:build']);
  if (build.status !== 0) process.exit(build.status ?? 1);
}

const host = process.env.E2E_HOST ?? '127.0.0.1';
const port = process.env.E2E_PORT ?? '4173';
const baseURL = `http://${host}:${port}`;
const viteCli = resolve('node_modules', 'vite', 'bin', 'vite.js');
mkdirSync(resolve('test-results'), { recursive: true });
const preview = spawn(process.execPath, [
  viteCli,
  'preview',
  '--outDir', 'e2e/.app-dist',
  '--host', host,
  '--port', port,
  '--strictPort',
], {
  cwd: process.cwd(),
  env: process.env,
  stdio: ['ignore', 'pipe', 'pipe'],
});
let previewOutput = '';
const capturePreviewOutput = (chunk, stream) => {
  const text = chunk.toString();
  previewOutput = `${previewOutput}${text}`.slice(-200_000);
  stream.write(text);
};
preview.stdout.on('data', (chunk) => capturePreviewOutput(chunk, process.stdout));
preview.stderr.on('data', (chunk) => capturePreviewOutput(chunk, process.stderr));

let exitCode = 1;
try {
  const deadline = Date.now() + 120_000;
  let ready = false;
  while (Date.now() < deadline) {
    if (preview.exitCode != null) {
      throw new Error(`Vite preview exited before readiness with code ${preview.exitCode}`);
    }
    try {
      const response = await fetch(baseURL, { signal: AbortSignal.timeout(2_000) });
      if (response.ok) {
        ready = true;
        break;
      }
    } catch {
      // Preview is still starting.
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 1_000));
  }
  if (!ready) throw new Error(`Vite preview was not ready within 120s at ${baseURL}`);

  const result = runNpm(['run', targetScript, '--', ...forwardedArgs], {
    env: {
      E2E_BASE_URL: baseURL,
      E2E_SKIP_WEBSERVER: '1',
    },
  });
  exitCode = result.status ?? 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
} finally {
  if (preview.exitCode == null) {
    preview.kill('SIGTERM');
    await Promise.race([
      new Promise((resolveExit) => preview.once('exit', resolveExit)),
      new Promise((resolveDelay) => setTimeout(resolveDelay, 5_000)),
    ]);
    if (preview.exitCode == null) preview.kill('SIGKILL');
  }
}

const proxyErrors = previewOutput.match(/(?:ECONNREFUSED|proxy error|http proxy error)/gi) ?? [];
if (proxyErrors.length > 0) {
  console.error('E2E preview emitted a proxy/network escape error.');
  exitCode = 1;
} else {
  console.log('E2E preview proxy escape check: 0 errors');
}

process.exit(exitCode);
