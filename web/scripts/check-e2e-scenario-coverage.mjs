#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const registrySource = readFileSync(resolve(webRoot, 'e2e', 'routeRegistry.ts'), 'utf8');
const declared = new Set();
const routePattern = /\{\s*name:\s*'([^']+)',\s*path:\s*'[^']+',\s*scenarios:\s*\[([^\]]+)\]/g;
for (const match of registrySource.matchAll(routePattern)) {
  for (const scenario of match[2].matchAll(/'([^']+)'/g)) {
    declared.add(`${match[1]}:${scenario[1]}`);
  }
}

const cli = resolve(webRoot, 'node_modules', '@playwright', 'test', 'cli.js');
const result = spawnSync(
  process.execPath,
  [cli, 'test', '--list', '--project=chromium-smoke', 'states.smoke.spec.ts'],
  {
    cwd: webRoot,
    encoding: 'utf8',
    env: { ...process.env, E2E_SKIP_WEBSERVER: '1' },
  },
);
if (result.status !== 0) {
  process.stderr.write(result.stderr);
  process.exit(result.status ?? 1);
}

const discovered = new Set();
for (const match of result.stdout.matchAll(/states\.smoke\.spec\.ts:\d+:\d+\s+›\s+([^›\r\n]+) renders the ([a-z]+) fixture/g)) {
  discovered.add(`${match[1]}:${match[2]}`);
}
const missing = [...declared].filter((key) => !discovered.has(key));
const extra = [...discovered].filter((key) => !declared.has(key));
if (declared.size === 0 || missing.length || extra.length) {
  console.error(JSON.stringify({
    declared: declared.size,
    discovered: discovered.size,
    missing,
    extra,
  }, null, 2));
  process.exit(1);
}
console.log(`Scenario discovery contract valid: ${discovered.size} registered Playwright tests cover every declared scenario.`);
