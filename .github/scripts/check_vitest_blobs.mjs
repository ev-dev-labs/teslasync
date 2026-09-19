import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Decode with Vitest's own dependency, including when npm does not hoist it.
const requireWeb = createRequire(new URL('../../web/package.json', import.meta.url));
const requireVitest = createRequire(requireWeb.resolve('vitest/package.json'));
const { parse } = requireVitest('flatted');

export function checkBlobs(directory, count, expectedFiles) {
  if (!Number.isInteger(count) || count < 1) throw new Error('Invalid shard count');
  const expectedNames = Array.from({ length: count }, (_, i) => `blob-${i + 1}-${count}.json`).sort();
  if (JSON.stringify(readdirSync(directory).sort()) !== JSON.stringify(expectedNames)) {
    throw new Error('Missing or unexpected Vitest shard artifacts');
  }
  const files = new Set();
  for (const name of expectedNames) {
    const [version, modules, errors, coverage] = parse(readFileSync(join(directory, name), 'utf8'));
    if (!version || !Array.isArray(modules) || modules.length === 0
      || !Array.isArray(errors) || errors.length > 0
      || !coverage || Object.keys(coverage).length === 0) {
      throw new Error(`${name}: missing tests, missing coverage, or unhandled errors`);
    }
    for (const module of modules) {
      if (typeof module.filepath !== 'string' || files.has(module.filepath)) {
        throw new Error(`${name}: invalid or duplicated test file`);
      }
      files.add(module.filepath);
    }
  }
  const expected = new Set(expectedFiles);
  if (files.size !== expected.size || [...expected].some(file => !files.has(file))) {
    throw new Error('Shard test files differ from full Vitest discovery');
  }
  console.log(`Validated ${count} Vitest shards: ${files.size} test files, no gaps or overlaps`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [, , directory, count, discovery] = process.argv;
  const files = JSON.parse(readFileSync(discovery, 'utf8')).map(entry => entry.file);
  checkBlobs(directory, Number(count), files);
}
