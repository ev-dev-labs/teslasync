#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const production = readFileSync(resolve(root, 'src', 'lib', 'routeRegistry.ts'), 'utf8');
const quality = readFileSync(resolve(root, 'e2e', 'routeRegistry.ts'), 'utf8');
const productionPaths = new Set([...production.matchAll(/\{\s*path:\s*'([^']+)'/g)].map((match) => match[1]));
const qualityPaths = [...quality.matchAll(/path:\s*'([^']+)'/g)].map((match) => match[1]);
const missing = qualityPaths.filter((path) => !productionPaths.has(path));
const duplicates = qualityPaths.filter((path, index) => qualityPaths.indexOf(path) !== index);

if (missing.length || duplicates.length) {
  console.error(JSON.stringify({ missing, duplicates }, null, 2));
  process.exit(1);
}
if (qualityPaths.length < 8) {
  console.error(`Expected at least 8 critical E2E routes; found ${qualityPaths.length}.`);
  process.exit(1);
}
console.log(`E2E route registry valid: ${qualityPaths.length} critical routes exist in ${productionPaths.size} application routes.`);
