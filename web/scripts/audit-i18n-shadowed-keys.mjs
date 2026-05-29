// Diagnostic + CI gate: find t('a.b.c') calls where a.b.c resolves to an
// object (not a string) in en.json. Such calls return the object — i18next
// logs "returned an object instead of string" and the fallback string is
// IGNORED — so the UI shows that error message instead of the intended copy.
//
// Fix the offending call sites by either:
// 1. Calling the leaf key directly: t('a.b.c.title', 'fallback')
// 2. Adding a sibling string under a.b.c (e.g. `.description`) and calling
// t('a.b.c.description', 'fallback')
//
// Exits 1 on any violation so it can run in CI / npm run lint.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const en = JSON.parse(fs.readFileSync(path.join(root, 'src/i18n/en.json'), 'utf8'));

function get(obj, key) {
  return key.split('.').reduce((a, p) => (a && typeof a === 'object' ? a[p] : undefined), obj);
}

function walk(dir, acc) {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    const s = fs.statSync(p);
    if (s.isDirectory()) {
      if (f === 'node_modules' || f === 'dist' || f.startsWith('.')) continue;
      walk(p, acc);
    } else if (/\.(tsx?|jsx?)$/.test(f)) {
      acc.push(p);
    }
  }
  return acc;
}

const files = walk(path.join(root, 'src'), []);
// Match t('key.path' or t("key.path" — keep keys to dotted ASCII identifiers.
// Skip test files (they may intentionally exercise fallback behavior).
const re = /[^a-zA-Z_]t\(\s*['"]([a-zA-Z0-9_.]+)['"]/g;
const broken = new Map();
for (const f of files) {
  if (/[\\/]__tests__[\\/]|\.test\.|\.spec\./.test(f)) continue;
  const txt = fs.readFileSync(f, 'utf8');
  let m;
  while ((m = re.exec(txt)) !== null) {
    const key = m[1];
    if (!key.includes('.')) continue;
    const v = get(en, key);
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const line = txt.slice(0, m.index).split('\n').length;
      if (!broken.has(key)) broken.set(key, []);
      broken.get(key).push(path.relative(root, f) + ':' + line);
    }
  }
}

if (broken.size === 0) {
  console.log('✅ audit:i18n-shadowed-keys — no violations');
  process.exit(0);
}

console.error('❌ audit:i18n-shadowed-keys — found bare t() calls that resolve to an OBJECT in en.json:');
console.error('   (i18next will log "returned an object instead of string" and ignore the fallback)');
console.error('');
for (const [k, locs] of broken) {
  console.error(`  ${k}`);
  for (const l of locs) console.error(`    at ${l}`);
}
console.error('');
console.error(`total broken keys: ${broken.size}`);
console.error('');
console.error('Fix: either call a leaf key (e.g. .title / .description) or add a sibling string under the parent.');
process.exit(1);
